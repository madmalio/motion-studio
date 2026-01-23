package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx      context.Context
	comfyURL string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		comfyURL: "http://127.0.0.1:8188",
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Ensure base directory exists
	baseDir := a.getAppDir()
	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		os.MkdirAll(baseDir, 0755)
	}

	// ---------------------------------------------------------
	// CRITICAL FIX: START THE ENGINE HERE
	// ---------------------------------------------------------
	go StartStreamServer()
	// ---------------------------------------------------------

	a.loadConfig()
}

// --- ENGINE BRIDGE (Frontend calls this) ---

// UpdateTimeline receives a list of file paths, generates a playlist,
// renders a gapless MP4 preview, and tells the frontend where to stream it from.
func (a *App) UpdateTimeline(clips []string) string {
	if server == nil {
		return "error: server_not_ready"
	}

	// 1. Generate the FFmpeg playlist file
	_, err := server.GeneratePlaylist(clips)
	if err != nil {
		fmt.Println("Error generating playlist:", err)
		return "error: " + err.Error()
	}

	// 2. Render a gapless MP4 preview (fast concat because clips match)
	_, err = server.RenderPreviewMP4()
	if err != nil {
		fmt.Println("Error rendering preview:", err)
		return "error: " + err.Error()
	}

	// 3. Return the preview URL with a timestamp to force reload
	return fmt.Sprintf("http://localhost:3456/preview.mp4?t=%d", time.Now().UnixMilli())
}

// --- MODELS ---

type Project struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Thumbnail  string `json:"thumbnail"`
	UpdatedAt  string `json:"updatedAt"`
	SceneCount int    `json:"sceneCount"`
}

type Scene struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	ShotCount int    `json:"shotCount"`
	UpdatedAt string `json:"updatedAt"`
	Thumbnail string `json:"thumbnail"`
}

type Shot struct {
	ID             string  `json:"id"`
	SceneID        string  `json:"sceneId"`
	Name           string  `json:"name"`
	SourceImage    string  `json:"sourceImage"`    // Path to input image
	Prompt         string  `json:"prompt"`         // AI Prompt
	MotionStrength int     `json:"motionStrength"` // 1-127
	Seed           int64   `json:"seed"`
	Duration       float64 `json:"duration"`    // Seconds
	Status         string  `json:"status"`      // DRAFT, RENDERING, DONE
	OutputVideo    string  `json:"outputVideo"` // Path to generated MP4
}

type Config struct {
	ComfyURL string `json:"comfyUrl"`
}

type TrackSetting struct {
	Locked  bool   `json:"locked"`
	Visible bool   `json:"visible"`
	Name    string `json:"name"`
}

type TimelineData struct {
	Tracks        [][]map[string]interface{} `json:"tracks"`
	TrackSettings []TrackSetting             `json:"trackSettings"`
}

type Workflow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// --- HELPER FUNCTIONS ---

// getAppDir returns the path to "Documents/MotionStudio"
func (a *App) getAppDir() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, "Documents", "MotionStudio")
}

// getWorkflowsDir returns the path to "Documents/MotionStudio/workflows"
func (a *App) getWorkflowsDir() string {
	dir := filepath.Join(a.getAppDir(), "workflows")
	os.MkdirAll(dir, 0755)
	return dir
}

func (a *App) saveProjectFile(p Project) {
	projectPath := filepath.Join(a.getAppDir(), p.ID)
	data, _ := json.MarshalIndent(p, "", "  ")
	os.WriteFile(filepath.Join(projectPath, "project.json"), data, 0644)
}

func (a *App) loadConfig() {
	path := filepath.Join(a.getAppDir(), "config.json")
	data, err := os.ReadFile(path)
	if err == nil {
		var config Config
		if err := json.Unmarshal(data, &config); err == nil && config.ComfyURL != "" {
			a.comfyURL = config.ComfyURL
		}
	}
}

// --- PROJECT FUNCTIONS ---

func (a *App) CreateProject(name string, format string) Project {
	id := fmt.Sprintf("%d", time.Now().Unix())
	projectPath := filepath.Join(a.getAppDir(), id)
	os.MkdirAll(projectPath, 0755)

	p := Project{
		ID:        id,
		Name:      name,
		Type:      format,
		UpdatedAt: time.Now().Format("2006-01-02 15:04"),
	}
	a.saveProjectFile(p)
	return p
}

func (a *App) GetProjects() []Project {
	baseDir := a.getAppDir()
	entries, _ := os.ReadDir(baseDir)
	var projects []Project

	for _, entry := range entries {
		if entry.IsDir() {
			p, err := a.GetProject(entry.Name())
			if err == nil {
				projects = append(projects, p)
			}
		}
	}
	return projects
}

func (a *App) GetProject(id string) (Project, error) {
	var p Project
	path := filepath.Join(a.getAppDir(), id, "project.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return p, err
	}
	err = json.Unmarshal(data, &p)

	// Calculate scene count dynamically
	scenesDir := filepath.Join(a.getAppDir(), id, "scenes")
	entries, _ := os.ReadDir(scenesDir)
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			count++
		}
	}
	p.SceneCount = count
	return p, err
}

func (a *App) UpdateProject(p Project) {
	p.UpdatedAt = time.Now().Format("2006-01-02 15:04")
	a.saveProjectFile(p)
}

func (a *App) DeleteProject(id string) {
	if id == "" {
		return
	}
	projectPath := filepath.Join(a.getAppDir(), id)
	os.RemoveAll(projectPath)
}

func (a *App) SetProjectThumbnail(projectId string, path string) {
	p, err := a.GetProject(projectId)
	if err != nil {
		return
	}
	p.Thumbnail = path
	a.saveProjectFile(p)
}

// --- SCENE FUNCTIONS ---

func (a *App) CreateScene(projectId string, name string) Scene {
	id := fmt.Sprintf("%d", time.Now().Unix())
	sceneDir := filepath.Join(a.getAppDir(), projectId, "scenes", id)
	os.MkdirAll(sceneDir, 0755)

	s := Scene{
		ID:        id,
		ProjectID: projectId,
		Name:      name,
		ShotCount: 0,
		UpdatedAt: time.Now().Format("2006-01-02 15:04"),
	}

	data, _ := json.MarshalIndent(s, "", "  ")
	os.WriteFile(filepath.Join(sceneDir, "scene.json"), data, 0644)
	return s
}

func (a *App) GetScenes(projectId string) []Scene {
	scenesDir := filepath.Join(a.getAppDir(), projectId, "scenes")
	entries, _ := os.ReadDir(scenesDir)
	var scenes []Scene

	for _, entry := range entries {
		if entry.IsDir() {
			var s Scene
			data, err := os.ReadFile(filepath.Join(scenesDir, entry.Name(), "scene.json"))
			if err == nil {
				json.Unmarshal(data, &s)
				// Count shots for the UI
				shots := a.GetShots(projectId, s.ID)
				s.ShotCount = len(shots)
				if len(shots) > 0 {
					s.Thumbnail = shots[0].SourceImage
				}
				scenes = append(scenes, s)
			}
		}
	}
	return scenes
}

func (a *App) DeleteScene(projectId string, sceneId string) {
	if projectId == "" || sceneId == "" {
		return
	}
	sceneDir := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId)
	os.RemoveAll(sceneDir)
}

// --- SHOT FUNCTIONS ---

// SaveShots writes the list of shots to shots.json inside the scene folder
func (a *App) SaveShots(projectId string, sceneId string, shots []Shot) {
	path := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, "shots.json")
	data, _ := json.MarshalIndent(shots, "", "  ")
	os.WriteFile(path, data, 0644)
}

// GetShots reads the list from disk
func (a *App) GetShots(projectId string, sceneId string) []Shot {
	path := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, "shots.json")

	data, err := os.ReadFile(path)
	if err != nil {
		return []Shot{}
	}

	var shots []Shot
	json.Unmarshal(data, &shots)
	return shots
}

func (a *App) DeleteShot(projectId string, sceneId string, shotId string) {
	shots := a.GetShots(projectId, sceneId)
	var newShots []Shot
	for _, s := range shots {
		if s.ID == shotId {
			if s.OutputVideo != "" {
				os.Remove(s.OutputVideo)
			}
		} else {
			newShots = append(newShots, s)
		}
	}
	a.SaveShots(projectId, sceneId, newShots)
}

func (a *App) CreateShot(sceneId string) Shot {
	return Shot{
		ID:             fmt.Sprintf("%d", time.Now().UnixNano()),
		SceneID:        sceneId,
		Name:           "New Shot",
		Status:         "DRAFT",
		MotionStrength: 127,
		Duration:       4.0,
	}
}

// --- TIMELINE FUNCTIONS ---

func (a *App) SaveTimeline(projectId string, sceneId string, timeline TimelineData) {
	path := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, "timeline.json")
	data, _ := json.MarshalIndent(timeline, "", "  ")
	os.WriteFile(path, data, 0644)
}

func (a *App) GetTimeline(projectId string, sceneId string) TimelineData {
	path := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, "timeline.json")
	data, err := os.ReadFile(path)
	var timeline TimelineData
	if err != nil {
		return timeline
	}
	json.Unmarshal(data, &timeline)
	return timeline
}

// GetComfyURL returns the current ComfyUI endpoint
func (a *App) GetComfyURL() string {
	return a.comfyURL
}

// SetComfyURL updates the ComfyUI endpoint
func (a *App) SetComfyURL(url string) {
	a.comfyURL = strings.TrimRight(url, "/")

	// Save Config
	path := filepath.Join(a.getAppDir(), "config.json")
	config := Config{ComfyURL: a.comfyURL}
	data, _ := json.MarshalIndent(config, "", "  ")
	os.WriteFile(path, data, 0644)
}

func (a *App) TestComfyConnection() bool {
	resp, err := http.Get(a.comfyURL + "/system_stats")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func (a *App) GetWorkflows() []Workflow {
	dir := a.getWorkflowsDir()
	entries, _ := os.ReadDir(dir)
	var workflows []Workflow
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			name := strings.TrimSuffix(e.Name(), ".json")
			workflows = append(workflows, Workflow{ID: name, Name: name})
		}
	}
	// Ensure default exists if list is empty
	if len(workflows) == 0 {
		defaultPath := filepath.Join(dir, "default.json")
		a.createDefaultWorkflow(defaultPath)
		workflows = append(workflows, Workflow{ID: "default", Name: "default"})
	}
	return workflows
}

// ImportWorkflow opens a file dialog for the user to select a workflow.json
// and copies it to the workflows directory with the given name.
func (a *App) ImportWorkflow(name string) string {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select ComfyUI Workflow (API Format)",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files", Pattern: "*.json"},
		},
	})
	if err != nil || selection == "" {
		return "" // Cancelled
	}

	data, err := os.ReadFile(selection)
	if err != nil {
		return "Error reading file"
	}

	// Simple sanitization
	safeName := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, name)
	if safeName == "" {
		safeName = "workflow_" + fmt.Sprintf("%d", time.Now().Unix())
	}

	dest := filepath.Join(a.getWorkflowsDir(), safeName+".json")
	err = os.WriteFile(dest, data, 0644)
	if err != nil {
		return "Error saving workflow"
	}

	return "Success"
}

func (a *App) RenameWorkflow(oldName, newName string) string {
	dir := a.getWorkflowsDir()
	oldPath := filepath.Join(dir, oldName+".json")

	// Simple sanitization
	safeName := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, newName)
	if safeName == "" {
		return "Invalid name"
	}

	newPath := filepath.Join(dir, safeName+".json")
	if _, err := os.Stat(newPath); err == nil {
		return "Name already exists"
	}

	err := os.Rename(oldPath, newPath)
	if err != nil {
		return "Error renaming file"
	}
	return "Success"
}

func (a *App) DeleteWorkflow(name string) string {
	if name == "default" {
		return "Cannot delete default workflow"
	}
	dir := a.getWorkflowsDir()
	path := filepath.Join(dir, name+".json")
	err := os.Remove(path)
	if err != nil {
		return "Error deleting file"
	}
	return "Success"
}

// --- LEGACY SUPPORT (Fixes build errors in SettingsProvider) ---

func (a *App) CheckWorkflowExists() bool {
	return len(a.GetWorkflows()) > 0
}

func (a *App) SelectAndSaveWorkflow() string {
	return a.ImportWorkflow("imported_workflow")
}

// --- COMFYUI INTEGRATION ---

// RenderShot orchestrates the ComfyUI generation
func (a *App) RenderShot(projectId string, sceneId string, shotId string, workflowName string) (Shot, error) {
	// 1. Get Shot
	shots := a.GetShots(projectId, sceneId)
	var shot *Shot
	for i := range shots {
		if shots[i].ID == shotId {
			shot = &shots[i]
			break
		}
	}
	if shot == nil {
		return Shot{}, fmt.Errorf("shot not found")
	}

	if shot.SourceImage == "" {
		return *shot, fmt.Errorf("source image is missing")
	}

	// 2. Ensure Workflow Template Exists
	if workflowName == "" {
		workflowName = "default"
	}
	workflowPath := filepath.Join(a.getWorkflowsDir(), workflowName+".json")
	if _, err := os.Stat(workflowPath); os.IsNotExist(err) {
		if workflowName == "default" {
			a.createDefaultWorkflow(workflowPath)
		} else {
			return *shot, fmt.Errorf("workflow %s not found", workflowName)
		}
	}

	// 3. Upload Image to ComfyUI
	comfyFilename, err := a.uploadImageToComfy(shot.SourceImage)
	if err != nil {
		return *shot, fmt.Errorf("upload failed: %v", err)
	}

	// 4. Prepare Workflow JSON
	workflowData, _ := os.ReadFile(workflowPath)
	var workflow map[string]interface{}
	json.Unmarshal(workflowData, &workflow)

	// 5. Inject Values (Smart Node Lookup)
	// We iterate over nodes to find specific types to update
	imageInjected := false
	for key, node := range workflow {
		nodeMap, ok := node.(map[string]interface{})
		if !ok {
			continue
		}

		classType, _ := nodeMap["class_type"].(string)
		inputs, _ := nodeMap["inputs"].(map[string]interface{})

		// Update Input Image
		if classType == "LoadImage" {
			fmt.Printf("Injecting Image into Node %s\n", key)
			inputs["image"] = comfyFilename
			imageInjected = true
		}

		// Update Seed (KSampler or SVD Conditioning)
		if classType == "KSampler" || classType == "SVD_img2vid_Conditioning" {
			if _, ok := inputs["seed"]; ok {
				fmt.Printf("Injecting Seed %d into Node %s\n", shot.Seed, key)
				inputs["seed"] = shot.Seed
			}
			if _, ok := inputs["noise_seed"]; ok {
				fmt.Printf("Injecting Noise Seed %d into Node %s\n", shot.Seed, key)
				inputs["noise_seed"] = shot.Seed
			}
		}

		// Update Motion Bucket (SVD)
		if classType == "SVD_img2vid_Conditioning" {
			fmt.Printf("Injecting Motion %d into Node %s\n", shot.MotionStrength, key)
			inputs["motion_bucket_id"] = shot.MotionStrength
		}

		// Update Prompt (CLIP Text Encode) - Optional, if you use text-to-video
		if classType == "CLIPTextEncode" {
			fmt.Printf("Injecting Prompt into Node %s\n", key)
			inputs["text"] = shot.Prompt
		}
	}

	if !imageInjected {
		fmt.Println("WARNING: No 'LoadImage' node found in workflow. Source image was NOT injected.")
	}

	// 6. Queue Prompt
	promptReq := map[string]interface{}{
		"prompt": workflow,
	}
	promptBytes, _ := json.Marshal(promptReq)
	resp, err := http.Post(a.comfyURL+"/prompt", "application/json", bytes.NewBuffer(promptBytes))
	if err != nil {
		return *shot, fmt.Errorf("failed to connect to ComfyUI: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return *shot, fmt.Errorf("ComfyUI API Error (%d): %s", resp.StatusCode, string(body))
	}

	var promptResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&promptResp)
	promptID := promptResp["prompt_id"].(string)

	// 7. Poll for Completion
	// In a real app, use WebSockets. For MVP, we poll history.
	outputFilename := ""
	outputSubfolder := ""
	outputType := ""
	timeout := time.After(10 * time.Minute) // Increased timeout for slower renders
	var histMap map[string]interface{}

	for {
		select {
		case <-timeout:
			return *shot, fmt.Errorf("rendering timed out")
		default:
		}

		time.Sleep(1 * time.Second)
		histResp, err := http.Get(a.comfyURL + "/history/" + promptID)
		if err != nil {
			continue
		}

		histMap = make(map[string]interface{})
		json.NewDecoder(histResp.Body).Decode(&histMap)
		histResp.Body.Close()

		if len(histMap) > 0 {
			// Job done! Find output filename
			data, ok := histMap[promptID].(map[string]interface{})
			if !ok {
				break
			}

			// Check for execution errors
			if status, ok := data["status"].(map[string]interface{}); ok {
				if statusStr, ok := status["status_str"].(string); ok && statusStr == "error" {
					return *shot, fmt.Errorf("ComfyUI execution failed")
				}
			}

			outputs, ok := data["outputs"].(map[string]interface{})
			if !ok {
				break
			}
			for _, outNode := range outputs {
				outNodeMap, ok := outNode.(map[string]interface{})
				if !ok {
					continue
				}

				// Check for "images" (Standard SaveImage)
				if images, ok := outNodeMap["images"].([]interface{}); ok && len(images) > 0 {
					if imgData, ok := images[0].(map[string]interface{}); ok {
						if filename, ok := imgData["filename"].(string); ok {
							outputFilename = filename
							if sub, ok := imgData["subfolder"].(string); ok {
								outputSubfolder = sub
							}
							if typ, ok := imgData["type"].(string); ok {
								outputType = typ
							}
							break
						}
					}
				}
				// Check for "videos" (VHS / Video Helper Suite)
				if videos, ok := outNodeMap["videos"].([]interface{}); ok && len(videos) > 0 {
					if vidData, ok := videos[0].(map[string]interface{}); ok {
						if filename, ok := vidData["filename"].(string); ok {
							outputFilename = filename
							if sub, ok := vidData["subfolder"].(string); ok {
								outputSubfolder = sub
							}
							if typ, ok := vidData["type"].(string); ok {
								outputType = typ
							}
							break
						}
					}
				}
				// Check for "gifs"
				if gifs, ok := outNodeMap["gifs"].([]interface{}); ok && len(gifs) > 0 {
					if gifData, ok := gifs[0].(map[string]interface{}); ok {
						if filename, ok := gifData["filename"].(string); ok {
							outputFilename = filename
							if sub, ok := gifData["subfolder"].(string); ok {
								outputSubfolder = sub
							}
							if typ, ok := gifData["type"].(string); ok {
								outputType = typ
							}
							break
						}
					}
				}
			}
			break
		}
	}

	if outputFilename == "" {
		// Debugging: Print raw outputs to help diagnose
		if len(histMap) > 0 {
			if data, ok := histMap[promptID].(map[string]interface{}); ok {
				if outputs, ok := data["outputs"]; ok {
					outBytes, _ := json.MarshalIndent(outputs, "", "  ")
					fmt.Printf("DEBUG: Raw ComfyUI Outputs:\n%s\n", string(outBytes))
				}
			}
		}
		return *shot, fmt.Errorf("job finished but no output file was found in history")
	}

	// 8. Download Result
	if outputFilename != "" {
		outPath := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, shotId+".mp4")

		// ComfyUI View Endpoint
		// http://.../view?filename=...&subfolder=&type=output
		query := fmt.Sprintf("filename=%s&subfolder=%s&type=%s", outputFilename, outputSubfolder, outputType)
		vidResp, err := http.Get(fmt.Sprintf("%s/view?%s", a.comfyURL, query))
		if err == nil {
			defer vidResp.Body.Close()
			if vidResp.StatusCode != 200 {
				return *shot, fmt.Errorf("download failed (Status %d)", vidResp.StatusCode)
			}

			outFile, _ := os.Create(outPath)
			defer outFile.Close()
			io.Copy(outFile, vidResp.Body)

			shot.OutputVideo = outPath
			shot.Status = "DONE"
			shot.Duration = a.getVideoDuration(outPath)
			a.SaveShots(projectId, sceneId, shots)
		} else {
			return *shot, fmt.Errorf("failed to download result: %v", err)
		}
	}

	return *shot, nil
}

func (a *App) getVideoDuration(path string) float64 {
	// Use ffprobe to get exact duration in seconds
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		path)

	// Start the command and capture output
	out, err := cmd.Output()
	if err != nil {
		fmt.Printf("Error running ffprobe on %s: %v\n", path, err)
		return 2.5 // DEBUG FALLBACK
	}

	// Parse duration
	durationStr := strings.TrimSpace(string(out))
	fmt.Printf("DEBUG: ffprobe output for %s: '%s'\n", path, durationStr)
	duration, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		fmt.Printf("Error parsing duration '%s' for file %s: %v\n", durationStr, path, err)
		return 2.5 // DEBUG FALLBACK
	}

	fmt.Printf("DEBUG: Final duration for %s: %f\n", path, duration)
	return duration
}

func (a *App) uploadImageToComfy(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("image", filepath.Base(path))
	io.Copy(part, file)
	writer.Close()

	req, _ := http.NewRequest("POST", a.comfyURL+"/upload/image", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("comfyui returned status %d", resp.StatusCode)
	}

	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)

	// Comfy returns name, possibly modified if duplicate
	if name, ok := res["name"].(string); ok {
		return name, nil
	}
	return filepath.Base(path), nil
}

func (a *App) createDefaultWorkflow(path string) {
	// A minimal valid SVD workflow JSON structure
	defaultJson := `{
 "3": {
    "inputs": {
      "seed": 0,
      "steps": 20,
      "cfg": 2.5,
      "sampler_name": "euler",
      "scheduler": "karras",
      "denoise": 1,
      "model": [ "14", 0 ],
      "positive": [ "12", 0 ],
      "negative": [ "12", 0 ],
      "latent_image": [ "12", 0 ]
    },
    "class_type": "KSampler"
  },
  "14": {
    "inputs": {
      "ckpt_name": "svd_xt.safetensors"
    },
    "class_type": "ImageOnlyCheckpointLoader"
  },
  "19": {
    "inputs": {
      "image": "example.png",
      "upload": "image"
    },
    "class_type": "LoadImage"
  }
}`
	os.WriteFile(path, []byte(defaultJson), 0644)
}

// --- UTILITY FUNCTIONS ---

func (a *App) SelectImage() string {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Image",
		Filters: []runtime.FileFilter{
			{DisplayName: "Images", Pattern: "*.png;*.jpg;*.jpeg;*.webp"},
		},
	})
	if err != nil {
		return ""
	}
	return selection
}

func (a *App) ReadImageBase64(path string) string {
	if path == "" {
		return ""
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	mimeType := "image/jpeg"
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".png" {
		mimeType = "image/png"
	} else if ext == ".webp" {
		mimeType = "image/webp"
	} else if ext == ".mp4" {
		mimeType = "video/mp4"
	}

	base64Str := base64.StdEncoding.EncodeToString(bytes)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Str)
}

// --- VIDEO / EXTENSION FUNCTIONS ---

// ExtractLastFrame uses FFmpeg to grab the final frame of a video
func (a *App) ExtractLastFrame(inputPath string) string {
	if inputPath == "" {
		return ""
	}

	ext := strings.ToLower(filepath.Ext(inputPath))
	baseName := inputPath[0 : len(inputPath)-len(ext)]
	outputPath := baseName + "_lastframe.png"

	// 1. If input is just an image, copy it (Simulating 'Extend' for static images)
	if ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" {
		source, err := os.Open(inputPath)
		if err != nil {
			return ""
		}
		defer source.Close()

		destination, err := os.Create(outputPath)
		if err != nil {
			return ""
		}
		defer destination.Close()

		io.Copy(destination, source)
		return outputPath
	}

	// 2. If input is video, run FFmpeg
	cmd := exec.Command("ffmpeg", "-sseof", "-0.25", "-i", inputPath, "-update", "1", "-q:v", "1", "-vframes", "1", outputPath, "-y")

	err := cmd.Run()
	if err != nil {
		fmt.Printf("FFmpeg Error: %v\n", err)
		return ""
	}

	return outputPath
}

// =========================================================================
//  ↓↓↓ VIDEO ENGINE (STREAMING SERVER) ↓↓↓
// =========================================================================

var server *StreamServer

type StreamServer struct {
	cmd        *exec.Cmd
	running    bool
	mu         sync.Mutex
	currentDir string
}

func NewStreamServer() *StreamServer {
	dir := filepath.Join(os.TempDir(), "motion_studio_stream")
	os.MkdirAll(dir, 0755)
	return &StreamServer{
		currentDir: dir,
	}
}

// GeneratePlaylist creates the ffmpeg "concat" text file
func (s *StreamServer) GeneratePlaylist(clips []string) (string, error) {
	var content strings.Builder
	for _, clip := range clips {
		// Normalize slashes for FFmpeg (Windows backslash fix)
		normalized := filepath.ToSlash(clip)
		// Escape single quotes for FFmpeg
		safePath := strings.ReplaceAll(normalized, "'", "'\\''")
		content.WriteString(fmt.Sprintf("file '%s'\n", safePath))
	}

	playlistPath := filepath.Join(s.currentDir, "playlist.txt")
	err := os.WriteFile(playlistPath, []byte(content.String()), 0644)
	return playlistPath, err
}

func (s *StreamServer) RenderPreviewMP4() (string, error) {
	playlistPath := filepath.Join(s.currentDir, "playlist.txt")
	if _, err := os.Stat(playlistPath); os.IsNotExist(err) {
		return "", fmt.Errorf("playlist not found")
	}

	outPath := filepath.Join(s.currentDir, "preview.mp4")

	// Fast concat (no re-encode). Requires matching codecs/params across clips.
	cmd := exec.Command("ffmpeg",
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", playlistPath,
		"-c", "copy",
		"-movflags", "+faststart",
		outPath,
	)

	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return outPath, nil
}

func (s *StreamServer) StartStreamHandler(w http.ResponseWriter, r *http.Request) {
	// MJPEG Headers
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary=ffmpeg")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	s.mu.Lock()
	// Clean up previous process
	if s.cmd != nil && s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}

	playlistPath := filepath.Join(s.currentDir, "playlist.txt")
	if _, err := os.Stat(playlistPath); os.IsNotExist(err) {
		s.mu.Unlock()
		return
	}

	// Run FFmpeg to output MJPEG stream to stdout
	cmd := exec.Command("ffmpeg",
		"-re",
		"-f", "concat",
		"-safe", "0",
		"-i", playlistPath,
		"-f", "mpjpeg", // Output format
		"-q:v", "2", // Quality (2-31)
		"-r", "24", // Frame rate
		"-", // Output to stdout
	)

	// Pipe FFmpeg stderr to console for debugging
	cmd.Stderr = os.Stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Println("Error creating stdout pipe:", err)
		s.mu.Unlock()
		return
	}

	if err := cmd.Start(); err != nil {
		log.Println("Error starting ffmpeg:", err)
		s.mu.Unlock()
		return
	}
	s.cmd = cmd
	s.running = true
	s.mu.Unlock()

	// Pipe stdout to HTTP response
	buffer := make([]byte, 32*1024)
	for {
		n, err := stdout.Read(buffer)
		if err != nil {
			break
		}
		if n > 0 {
			w.Write(buffer[:n])
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
	}
}

// GetVideoDuration returns the duration (seconds) of a video file using ffprobe.
func (a *App) GetVideoDuration(path string) float64 {
	return a.getVideoDuration(path)
}

func StartStreamServer() {
	server = NewStreamServer()
	mux := http.NewServeMux()

	// Legacy MJPEG stream (still available)
	mux.HandleFunc("/stream", server.StartStreamHandler)

	// Gapless MP4 preview output
	mux.HandleFunc("/preview.mp4", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(server.currentDir, "preview.mp4")
		if _, err := os.Stat(path); err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		http.ServeFile(w, r, path)
	})

	// Serve local video files for pre-loading
	mux.HandleFunc("/video/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		// /video/C:/Path/To/File.mp4 -> C:/Path/To/File.mp4
		path := strings.TrimPrefix(r.URL.Path, "/video/")
		http.ServeFile(w, r, path)
	})

	fmt.Println("🎥 Video Engine listening on http://localhost:3456/stream")
	http.ListenAndServe(":3456", mux)
}
