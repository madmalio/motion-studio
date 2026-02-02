package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"       // <--- NEW
	"github.com/gorilla/websocket" // <--- NEW
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx      context.Context
	comfyURL string
	clientID string // <--- NEW: For WebSocket connection
	nodeMappings map[string]map[string]string // Class -> Input -> Type
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		comfyURL: "http://127.0.0.1:8188",
		clientID: uuid.New().String(), // <--- Generate ID on startup
		nodeMappings: make(map[string]map[string]string),
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
	a.loadNodeMappings()
}

// Ping is a fast, safe handshake that lets the frontend verify the Wails bridge
// is actually ready for backend calls.
func (a *App) Ping() bool {
	return true
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
	AudioPath      string  `json:"audioPath"`      // Path to audio file
	AudioStart     float64 `json:"audioStart"`     // Start trim time
	AudioDuration  float64 `json:"audioDuration"`  // Duration to keep
	Prompt         string  `json:"prompt"`         // AI Prompt
	MotionStrength int     `json:"motionStrength"` // 1-127
	Seed           int64   `json:"seed"`
	Duration       float64 `json:"duration"`    // Seconds
	Status         string  `json:"status"`      // DRAFT, RENDERING, DONE
	OutputVideo    string  `json:"outputVideo"` // Path to generated MP4
	Waveform       []float64 `json:"waveform"`
}

type Config struct {
	ComfyURL string `json:"comfyUrl"`
}

type TrackSetting struct {
	Locked  bool   `json:"locked"`
	Visible bool   `json:"visible"`
	Name    string `json:"name"`
	Type    string `json:"type"`
}

type ExportOptions struct {
	Format       string `json:"format"`       // mp4, mov, mkv, mp3, wav
	IncludeVideo bool   `json:"includeVideo"`
	IncludeAudio bool   `json:"includeAudio"`
	Quality      string `json:"quality"`
}

type TimelineData struct {
	Tracks        [][]map[string]interface{} `json:"tracks"`
	TrackSettings []TrackSetting             `json:"trackSettings"`
}

type Workflow struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	HasAudio bool   `json:"hasAudio"` // Flag for UI
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

func (a *App) loadNodeMappings() {
	path := filepath.Join(a.getAppDir(), "node_mappings.json")
	data, err := os.ReadFile(path)
	
	// Default Mappings
	defaults := map[string]map[string]string{
		"LoadImage":                {"image": "IMAGE"},
		"CLIPTextEncode":           {"text": "PROMPT"},
		"CLIPTextEncodeSDXL":       {"text_g": "PROMPT", "text_l": "PROMPT"},
		"WanVideoTextEncodeCached": {"prompt": "PROMPT", "positive_prompt": "PROMPT"},
		"KSampler":                 {"seed": "SEED", "noise_seed": "SEED"},
		"SVD_img2vid_Conditioning": {"seed": "SEED", "motion_bucket_id": "MOTION"},
		"LoadAudio":                {"audio": "AUDIO", "filename": "AUDIO"},
		"AudioLoader":              {"audio_file": "AUDIO"},
		"EmptyLatentVideo":         {"frame_count": "MAX_FRAMES"},
		"MultiTalkWav2VecEmbeds":   {"num_frames": "MAX_FRAMES"},
	}

	if err == nil {
		json.Unmarshal(data, &a.nodeMappings)
	}

	// Merge defaults if missing
	for classType, rules := range defaults {
		if _, exists := a.nodeMappings[classType]; !exists {
			a.nodeMappings[classType] = rules
		}
	}
}

func (a *App) saveNodeMappings() {
	path := filepath.Join(a.getAppDir(), "node_mappings.json")
	data, _ := json.MarshalIndent(a.nodeMappings, "", "  ")
	os.WriteFile(path, data, 0644)
}

func (a *App) analyzeWorkflowForMappings(workflowData []byte) {
	var workflow map[string]interface{}
	if err := json.Unmarshal(workflowData, &workflow); err != nil {
		return
	}

	updated := false
	for _, node := range workflow {
		if nodeMap, ok := node.(map[string]interface{}); ok {
			if classType, ok := nodeMap["class_type"].(string); ok {
				// Heuristics for new nodes
				if _, known := a.nodeMappings[classType]; !known {
					inputs, _ := nodeMap["inputs"].(map[string]interface{})
					newRules := make(map[string]string)

					for key := range inputs {
						lowerKey := strings.ToLower(key)
						if lowerKey == "seed" || lowerKey == "noise_seed" {
							newRules[key] = "SEED"
						} else if lowerKey == "text" || lowerKey == "prompt" || lowerKey == "positive" || lowerKey == "text_g" || lowerKey == "text_l" {
							newRules[key] = "PROMPT"
						} else if (strings.Contains(strings.ToLower(classType), "image") && lowerKey == "image") {
							newRules[key] = "IMAGE"
						} else if (strings.Contains(strings.ToLower(classType), "audio") && (lowerKey == "audio" || lowerKey == "filename" || lowerKey == "audio_file")) {
							newRules[key] = "AUDIO"
						} else if (lowerKey == "max_frames" || lowerKey == "frame_count" || lowerKey == "video_length" || lowerKey == "num_frames") {
							newRules[key] = "MAX_FRAMES"
						}
					}

					if len(newRules) > 0 {
						a.nodeMappings[classType] = newRules
						updated = true
					}
				}
			}
		}
	}

	if updated {
		a.saveNodeMappings()
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
			// Read file to detect audio nodes
			hasAudio := false
			content, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err == nil {
				var workflowData map[string]interface{}
				// Check inside the JSON for specific nodes
				if json.Unmarshal(content, &workflowData) == nil {
					for _, nodeData := range workflowData {
						if nodeMap, ok := nodeData.(map[string]interface{}); ok {
							if classType, ok := nodeMap["class_type"].(string); ok {
								lowerType := strings.ToLower(classType)
								// Detect standard audio loading nodes
								if strings.Contains(lowerType, "loadaudio") ||
									strings.Contains(lowerType, "audioloader") {
									hasAudio = true
									break
								}
							}
						}
					}
				}
			}

			name := strings.TrimSuffix(e.Name(), ".json")
			workflows = append(workflows, Workflow{
				ID:       name,
				Name:     name,
				HasAudio: hasAudio, // Set the flag
			})
		}
	}
	// Ensure default exists if list is empty
	if len(workflows) == 0 {
		defaultPath := filepath.Join(dir, "default.json")
		a.createDefaultWorkflow(defaultPath)
		workflows = append(workflows, Workflow{ID: "default", Name: "default", HasAudio: false})
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

	// Analyze and update mappings
	a.analyzeWorkflowForMappings(data)

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

	// ---------------------------------------------------------
	// 1.5 HANDLE AUDIO TRIMMING & DURATION CALC
	// ---------------------------------------------------------
	localAudioPath := shot.AudioPath
	finalDuration := shot.AudioDuration

	// If no trim set, calculate full duration
	if shot.AudioPath != "" && finalDuration <= 0 {
		finalDuration = a.getVideoDuration(shot.AudioPath)
	}

	// Apply Trim if needed
	if shot.AudioPath != "" && shot.AudioDuration > 0 {
		tempName := fmt.Sprintf("trim_%s_%d%s", shot.ID, time.Now().Unix(), filepath.Ext(shot.AudioPath))
		tempPath := filepath.Join(os.TempDir(), tempName)

		cmd := exec.Command("ffmpeg",
			"-y",
			"-i", shot.AudioPath,
			"-ss", fmt.Sprintf("%f", shot.AudioStart),
			"-t", fmt.Sprintf("%f", shot.AudioDuration),
			"-c", "copy",
			tempPath,
		)

		if err := cmd.Run(); err == nil {
			fmt.Println("Audio trimmed successfully:", tempPath)
			localAudioPath = tempPath
		} else {
			fmt.Printf("Warning: Audio trim failed, using original. Error: %v\n", err)
		}
	}

	// Calculate Max Frames
	if finalDuration <= 0 { finalDuration = 1.0 }
	maxFrames := int(finalDuration * 25)
	
	// ---------------------------------------------------------
	// 2. UPLOAD ASSETS TO COMFYUI (The Fix)
	// ---------------------------------------------------------
	
	// A. Upload Image
	comfyImageName, err := a.uploadImageToComfy(shot.SourceImage)
	if err != nil {
		return *shot, fmt.Errorf("image upload failed: %v", err)
	}

	// B. Upload Audio (If exists)
	comfyAudioName := ""
	if localAudioPath != "" {
		// We reuse the image upload function because ComfyUI's /upload/image endpoint 
		// handles audio files correctly by placing them in the input folder.
		uploadedName, err := a.uploadImageToComfy(localAudioPath)
		if err != nil {
			return *shot, fmt.Errorf("audio upload failed: %v", err)
		}
		comfyAudioName = uploadedName
		fmt.Printf("Audio uploaded to ComfyUI as: %s\n", comfyAudioName)
	}

	// ---------------------------------------------------------
	// 2.5 CONNECT WEBSOCKET (REAL-TIME PROGRESS)
	// ---------------------------------------------------------
	wsScheme := "ws"
	if strings.HasPrefix(a.comfyURL, "https") {
		wsScheme = "wss"
	}
	wsURL := strings.Replace(a.comfyURL, "http://", "", 1)
	wsURL = strings.Replace(wsURL, "https://", "", 1)
	wsURL = fmt.Sprintf("%s://%s/ws?clientId=%s", wsScheme, wsURL, a.clientID)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		fmt.Println("WS Connection Failed, falling back to polling:", err)
		// Don't error out, just continue without progress bars
	} else {
		defer conn.Close()
	}

	// 3. Ensure Workflow Template Exists
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

	// 4. Prepare Workflow JSON
	workflowData, _ := os.ReadFile(workflowPath)
	var workflow map[string]interface{}
	json.Unmarshal(workflowData, &workflow)

	// 5. Inject Values (Dynamic System)
	imageInjected := false
	
	// Prepare Injection Values
	injectValues := map[string]interface{}{
		"IMAGE":  comfyImageName,
		"PROMPT": shot.Prompt,
		"SEED":   shot.Seed,
		"MOTION": shot.MotionStrength,
	}
	
	if comfyAudioName != "" {
		injectValues["AUDIO"] = comfyAudioName
		injectValues["MAX_FRAMES"] = maxFrames
	}

	for _, node := range workflow {
		nodeMap, ok := node.(map[string]interface{})
		if !ok { continue }

		classType, _ := nodeMap["class_type"].(string)
		inputs, _ := nodeMap["inputs"].(map[string]interface{})
		
		// Check if we have mappings for this node type
		if rules, known := a.nodeMappings[classType]; known {
			for inputKey, valueType := range rules {
				// Only inject if the node actually has this input
				if _, inputExists := inputs[inputKey]; inputExists {
					// Safety: Don't overwrite existing links (arrays) with injected values
					if _, isLink := inputs[inputKey].([]interface{}); isLink {
						continue
					}

					if val, hasVal := injectValues[valueType]; hasVal {
						inputs[inputKey] = val
						if valueType == "IMAGE" {
							imageInjected = true
						}
					}
				}
			}
		}

		// Smart Fallback: Check Node Title (for generic nodes like INTConstant)
		// This handles your specific case where "INTConstant" is named "Max frames"
		if meta, ok := nodeMap["_meta"].(map[string]interface{}); ok {
			if title, ok := meta["title"].(string); ok {
				lowerTitle := strings.ToLower(title)
				if strings.Contains(lowerTitle, "max frames") || strings.Contains(lowerTitle, "frame count") {
					if val, hasVal := injectValues["MAX_FRAMES"]; hasVal {
						// Inject into 'value' (standard for INTConstant/Primitive nodes)
						if _, ok := inputs["value"]; ok { inputs["value"] = val }
					}
				}
			}
		}
	}

	if !imageInjected {
		fmt.Println("WARNING: No 'LoadImage' node found.")
	}

	// 6. Queue Prompt with Client ID
	promptReq := map[string]interface{}{
		"prompt":    workflow,
		"client_id": a.clientID, // <--- Key for WebSocket
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

	// 7. LISTEN FOR WEBSOCKET PROGRESS
	outputFilename := ""
	outputSubfolder := ""
	outputType := ""

	// We use a channel to signal completion from the WS loop
	doneChan := make(chan bool)

	if conn != nil {
		go func() {
			for {
				_, message, err := conn.ReadMessage()
				if err != nil {
					close(doneChan)
					return
				}

				var msg map[string]interface{}
				json.Unmarshal(message, &msg)
				msgType, _ := msg["type"].(string)
				data, _ := msg["data"].(map[string]interface{})

				// Emit Progress
				if msgType == "progress" {
					val := data["value"].(float64)
					max := data["max"].(float64)
					percentage := int((val / max) * 100)
					runtime.EventsEmit(a.ctx, "comfy:progress", percentage)
				}

				// Emit Status Text
				if msgType == "executing" {
					node := data["node"]
					if node == nil {
						// execution finished (node is null)
					} else {
						runtime.EventsEmit(a.ctx, "comfy:status", fmt.Sprintf("Executing Node %v", node))
					}
				}

				// Execution Finished
				if msgType == "execution_success" {
					sid, _ := data["prompt_id"].(string)
					if sid == promptID {
						close(doneChan)
						return
					}
				}
			}
		}()
	} else {
		// Fallback for no WS: just close doneChan immediately to trigger polling
		close(doneChan)
	}

	// Wait for WS completion or Timeout
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

loop:
	for {
		select {
		case <-doneChan:
			break loop
		case <-ticker.C:
			// Fallback: Check history API in case WS missed the event (e.g. sleep)
			if resp, err := http.Get(a.comfyURL + "/history/" + promptID); err == nil {
				var h map[string]interface{}
				json.NewDecoder(resp.Body).Decode(&h)
				resp.Body.Close()
				if _, ok := h[promptID]; ok {
					break loop
				}
			}
		case <-time.After(10 * time.Minute):
			return *shot, fmt.Errorf("timeout")
		}
	}

	// 8. Poll History (Retry logic to handle race conditions)
	for i := 0; i < 5; i++ {
		histResp, err := http.Get(a.comfyURL + "/history/" + promptID)
		if err == nil {
			var histMap map[string]interface{}
			json.NewDecoder(histResp.Body).Decode(&histMap)
			histResp.Body.Close()

			if data, ok := histMap[promptID].(map[string]interface{}); ok {
				// Check for explicit errors
				if status, ok := data["status"].(map[string]interface{}); ok {
					if statusStr, ok := status["status_str"].(string); ok && statusStr == "error" {
						// Try to find the error message
						if messages, ok := status["messages"].([]interface{}); ok && len(messages) > 0 {
							for _, msg := range messages {
								if pair, ok := msg.([]interface{}); ok && len(pair) >= 2 {
									if typeStr, ok := pair[0].(string); ok && typeStr == "execution_error" {
										// Try to extract clean exception message
										if errMap, ok := pair[1].(map[string]interface{}); ok {
											if excMsg, ok := errMap["exception_message"].(string); ok {
												return *shot, fmt.Errorf("ComfyUI Error: %s", excMsg)
											}
										}
										return *shot, fmt.Errorf("ComfyUI Error: %v", pair[1])
									}
								}
							}
							// Fallback: return the last message
							return *shot, fmt.Errorf("ComfyUI Error: %v", messages[len(messages)-1])
						}
						return *shot, fmt.Errorf("ComfyUI reported an error during execution")
					}
				}

				if outputs, ok := data["outputs"].(map[string]interface{}); ok {
					for _, outNode := range outputs {
						outNodeMap, ok := outNode.(map[string]interface{})
						if !ok {
							continue
						}
						// Check images/videos/gifs
						if items, ok := outNodeMap["videos"].([]interface{}); ok && len(items) > 0 {
							d := items[0].(map[string]interface{})
							outputFilename = d["filename"].(string)
							outputSubfolder, _ = d["subfolder"].(string)
							outputType, _ = d["type"].(string)
						} else if items, ok := outNodeMap["images"].([]interface{}); ok && len(items) > 0 {
							d := items[0].(map[string]interface{})
							outputFilename = d["filename"].(string)
							outputSubfolder, _ = d["subfolder"].(string)
							outputType, _ = d["type"].(string)
						} else if items, ok := outNodeMap["gifs"].([]interface{}); ok && len(items) > 0 {
							d := items[0].(map[string]interface{})
							outputFilename = d["filename"].(string)
							outputSubfolder, _ = d["subfolder"].(string)
							outputType, _ = d["type"].(string)
						}
					}
				}
			}
		}

		if outputFilename != "" {
			break
		}
		time.Sleep(1 * time.Second)
	}

	if outputFilename == "" {
		return *shot, fmt.Errorf("job finished but no output file was found")
	}

	// 9. Download Result
	outPath := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, shotId+".mp4")
	query := fmt.Sprintf("filename=%s&subfolder=%s&type=%s", outputFilename, outputSubfolder, outputType)
	vidResp, err := http.Get(fmt.Sprintf("%s/view?%s", a.comfyURL, query))
	
	if err == nil {
		defer vidResp.Body.Close()
		if vidResp.StatusCode != 200 {
			return *shot, fmt.Errorf("download failed (Status %d)", vidResp.StatusCode)
		}

		outFile, _ := os.Create(outPath)
		io.Copy(outFile, vidResp.Body)
		outFile.Close()

		shot.OutputVideo = outPath
		shot.Status = "DONE"
		shot.Duration = a.getVideoDuration(outPath)
		a.SaveShots(projectId, sceneId, shots)
	} else {
		return *shot, fmt.Errorf("failed to download result: %v", err)
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

// ImportImage opens a dialog, copies the file to the project assets, and returns the new path
func (a *App) ImportImage(projectId string) string {
	// 1. Open the File Dialog to let user pick a file
	srcPath := a.SelectImage()
	if srcPath == "" {
		return ""
	}

	// 2. Define the destination folder: Documents/MotionStudio/<ProjectID>/assets
	assetsDir := filepath.Join(a.getAppDir(), projectId, "assets")
	// Ensure the folder exists
	os.MkdirAll(assetsDir, 0755)

	// 3. Create a unique filename (timestamp + original extension)
	// This prevents overwriting if you import "image.png" twice
	ext := filepath.Ext(srcPath)
	newFilename := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	destPath := filepath.Join(assetsDir, newFilename)

	// 4. Copy the file
	input, err := os.ReadFile(srcPath)
	if err != nil {
		return ""
	}

	err = os.WriteFile(destPath, input, 0644)
	if err != nil {
		return ""
	}

	// 5. Return the NEW safe path inside the project
	return destPath
}

// ImportAudio opens a dialog, copies the file to the project assets, and returns the new path
func (a *App) ImportAudio(projectId string) string {
	// 1. Open the Audio File Dialog
	srcPath := a.SelectAudio()
	if srcPath == "" {
		return ""
	}

	// 2. Define the destination folder
	assetsDir := filepath.Join(a.getAppDir(), projectId, "assets")
	os.MkdirAll(assetsDir, 0755)

	// 3. Create a unique filename
	ext := filepath.Ext(srcPath)
	newFilename := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	destPath := filepath.Join(assetsDir, newFilename)

	// 4. Copy the file
	input, err := os.ReadFile(srcPath)
	if err != nil {
		return ""
	}

	err = os.WriteFile(destPath, input, 0644)
	if err != nil {
		return ""
	}

	return destPath
}

// SelectAudio opens the file dialog for audio files
func (a *App) SelectAudio() string {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Audio File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Audio", Pattern: "*.mp3;*.wav;*.ogg;*.m4a;*.flac"},
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

// ExtractAudioPeaks reads a video/audio file and returns a normalized waveform (0.0 - 1.0)
// samplesPerSec determines resolution (e.g., 20 peaks per second of video)
func (a *App) ExtractAudioPeaks(filePath string, samplesPerSec int) ([]float64, error) {
	// 1. Construct FFmpeg command
	// -i input: input file
	// -vn: disable video (faster)
	// -ac 1: downmix to mono (we only need one wave)
	// -ar 4000: low sample rate (sufficient for visual waveform)
	// -f s16le: output raw 16-bit little-endian PCM
	// -: output to stdout
	cmd := exec.Command("ffmpeg", "-i", filePath, "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "-")
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	var peaks []float64
	reader := bufio.NewReader(stdout)
	
	// 4000Hz sample rate / samplesPerSec (e.g. 20) = 200 samples per peak chunk
	chunkSize := 4000 / samplesPerSec
	
	// Buffer for one sample (int16 = 2 bytes)
	sampleBytes := make([]byte, 2)
	
	currentMax := 0.0
	sampleCount := 0

	for {
		_, err := io.ReadFull(reader, sampleBytes)
		if err == io.EOF {
			break
		}
		if err != nil {
			break 
		}

		// Convert bytes to int16
		val := int16(binary.LittleEndian.Uint16(sampleBytes))
		absVal := math.Abs(float64(val))

		// Track max in this chunk
		if absVal > currentMax {
			currentMax = absVal
		}
		sampleCount++

		// Push to peaks when chunk is full
		if sampleCount >= chunkSize {
			// Normalize int16 range (32768) to 0.0-1.0
			peaks = append(peaks, currentMax/32768.0)
			currentMax = 0
			sampleCount = 0
		}
	}
    
	cmd.Wait() 
	return peaks, nil
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

// --- EXPORT ENGINE ---

type RenderSegment struct {
	SourcePath string
	InPoint    float64
	OutPoint   float64
	Duration   float64
	IsImage    bool
	AudioSource string
}

func (a *App) ExportVideo(projectId string, sceneId string, options ExportOptions) string {
	// 1. Select Output File
	ext := "." + options.Format
	filterPattern := "*" + ext
	
	outPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export " + strings.ToUpper(options.Format),
		DefaultFilename: "export" + ext,
		Filters: []runtime.FileFilter{
			{DisplayName: strings.ToUpper(options.Format) + " File", Pattern: filterPattern},
		},
	})
	if err != nil || outPath == "" {
		return "Cancelled"
	}

	// Emit initial progress
	runtime.EventsEmit(a.ctx, "export:progress", 0)

	// 2. Load Timeline
	timeline := a.GetTimeline(projectId, sceneId)
	if len(timeline.Tracks) == 0 {
		return "Empty timeline"
	}

	tempDir := os.TempDir()
	videoOutput := ""
	audioOutput := ""
	
	// 0. Prepare Black Frame for Gaps
	blackPath := filepath.Join(tempDir, "black.png")
	if _, err := os.Stat(blackPath); os.IsNotExist(err) {
		data, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
		os.WriteFile(blackPath, data, 0644)
	}

	// 0.5 Prepare Silence for Audio Gaps (1 hour buffer)
	silencePath := filepath.Join(tempDir, "silence.wav")
	if _, err := os.Stat(silencePath); os.IsNotExist(err) {
		exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "3600", "-c:a", "pcm_s16le", silencePath).Run()
	}

	// Helper to parse map to struct-like
	type Item struct {
		ID          string
		StartTime   float64
		Duration    float64
		TrimStart   float64
		OutputVideo string
		AudioPath   string
		SourceImage string
		PairID		string
	}

	// --- PASS 1: ANALYZE TIMELINE (VISUALS) ---
	runtime.EventsEmit(a.ctx, "export:status", "Analyzing Timeline...")

	// Map to track which PairIDs are currently visible on screen
	// If a video is covered up, its PairID won't be in this map.
	visiblePairIDs := make(map[string]bool)

	// 1. Collect all time points
	timePoints := []float64{0.0}

	var tracks [][]Item
	for _, rawTrack := range timeline.Tracks {
		var track []Item
		for _, rawItem := range rawTrack {
			item := Item{}
			if v, ok := rawItem["startTime"].(float64); ok { item.StartTime = v }
			if v, ok := rawItem["duration"].(float64); ok { item.Duration = v }
			if v, ok := rawItem["trimStart"].(float64); ok { item.TrimStart = v }
			if v, ok := rawItem["outputVideo"].(string); ok { item.OutputVideo = v }
			if v, ok := rawItem["audioPath"].(string); ok { item.AudioPath = v }
			if v, ok := rawItem["sourceImage"].(string); ok { item.SourceImage = v }
			if v, ok := rawItem["pairId"].(string); ok { item.PairID = v } // <--- Parse PairID

			track = append(track, item)
			timePoints = append(timePoints, item.StartTime)
			timePoints = append(timePoints, item.StartTime+item.Duration)
		}
		tracks = append(tracks, track)
	}

	// 2. Sort and Unique
	sort.Float64s(timePoints)
	uniquePoints := []float64{}
	if len(timePoints) > 0 {
		uniquePoints = append(uniquePoints, timePoints[0])
		for i := 1; i < len(timePoints); i++ {
			if timePoints[i] > timePoints[i-1]+0.001 {
				uniquePoints = append(uniquePoints, timePoints[i])
			}
		}
	}

	var segments []RenderSegment

	// 3. Iterate Time Slices
	for i := 0; i < len(uniquePoints)-1; i++ {
		start := uniquePoints[i]
		end := uniquePoints[i+1]
		mid := (start + end) / 2
		dur := end - start

		var activeItem *Item

		// 4. Find Top-Most Visible Video
		for tIdx, track := range tracks {
			if tIdx < len(timeline.TrackSettings) {
				ts := timeline.TrackSettings[tIdx]
				if !ts.Visible { continue }
				isAudio := ts.Type == "audio" || strings.HasPrefix(ts.Name, "A")
				if isAudio { continue }
			}

			foundClip := false
			for _, item := range track {
				if mid >= item.StartTime && mid < item.StartTime+item.Duration {
					itemCopy := item
					activeItem = &itemCopy
					foundClip = true
					break
				}
			}
			if foundClip { break }
		}

		if activeItem != nil {
			// Register this clip as "Visible"
			if activeItem.PairID != "" {
				visiblePairIDs[activeItem.PairID] = true
			}

			offset := start - activeItem.StartTime + activeItem.TrimStart
			source := activeItem.OutputVideo
			if source == "" { source = activeItem.SourceImage }

			// ECHO FIX: Force AudioSource to Silence.
			// We will rely entirely on Pass 3 (Audio Tracks) to render the audio.
			// This prevents the "Video File" and "Audio File" from playing at the same time.
			segments = append(segments, RenderSegment{
				SourcePath:  source,
				InPoint:     offset,
				OutPoint:    offset + dur,
				Duration:    dur,
				IsImage:     strings.HasSuffix(source, ".png") || strings.HasSuffix(source, ".jpg"),
				AudioSource: silencePath, // <--- Key Change
			})
		} else {
			segments = append(segments, RenderSegment{
				SourcePath:  blackPath,
				AudioSource: silencePath,
				Duration:    dur,
				IsImage:     true,
				InPoint:     0,
				OutPoint:    dur,
			})
		}
	}

	// --- PASS 2: RENDER VIDEO ---
	if options.IncludeVideo && (options.Format == "mp4" || options.Format == "mov" || options.Format == "mkv") {
		var concat strings.Builder
		concat.WriteString("ffconcat version 1.0\n")
		for _, seg := range segments {
			safePath := strings.ReplaceAll(filepath.ToSlash(seg.SourcePath), "'", "'\\''")
			concat.WriteString(fmt.Sprintf("file '%s'\n", safePath))
			if !seg.IsImage {
				concat.WriteString(fmt.Sprintf("inpoint %f\n", seg.InPoint))
				concat.WriteString(fmt.Sprintf("outpoint %f\n", seg.OutPoint))
			}
			if seg.IsImage {
				concat.WriteString(fmt.Sprintf("duration %f\n", seg.Duration))
			}
		}

		listPath := filepath.Join(tempDir, fmt.Sprintf("export_list_%d.txt", time.Now().Unix()))
		os.WriteFile(listPath, []byte(concat.String()), 0644)

		videoOutput = filepath.Join(tempDir, fmt.Sprintf("temp_video_%d.%s", time.Now().Unix(), options.Format))
		args := []string{"-y", "-f", "concat", "-safe", "0", "-i", listPath}

		// --- QUALITY LOGIC ---
		// H.264 (MP4/MKV): Lower CRF = Higher Quality.
		// ProRes (MOV): Higher Profile = Higher Quality.
		crf := "23"         // Default Medium
		proresProfile := "2" // Default Standard (422)

		switch options.Quality {
		case "high":
			crf = "18"          // Visually Lossless
			proresProfile = "3" // HQ (High Quality)
		case "low":
			crf = "28"          // Compressed / Small
			proresProfile = "0" // Proxy (Low Res/High Speed)
		default: // medium
			crf = "23"
			proresProfile = "2"
		}

		if options.Format == "mov" {
			// --- PRORES LOGIC ---
			args = append(args,
				"-c:v", "prores_ks",
				"-profile:v", proresProfile,
				"-vendor", "apl0",
				"-pix_fmt", "yuv422p10le",
				"-an", videoOutput)
		} else {
			// --- H.264 LOGIC (MP4 / MKV) ---
			args = append(args,
				"-c:v", "libx264",
				"-preset", "fast",
				"-crf", crf, // Uses the dynamic CRF calculated above
				"-an", videoOutput)
		}

		if err := a.runFFmpegWithProgress(args, "Video"); err != nil {
			return "Video Render Error: " + err.Error()
		}
	}

// --- PASS 3: RENDER AUDIO ---
	if options.IncludeAudio {
		runtime.EventsEmit(a.ctx, "export:status", "Rendering Audio...")

		// 3a. Render "Main" Audio (from Video Tracks) using Concat
		// This ensures audio follows video visibility (V2 mutes V1)
		var audioConcat strings.Builder
		audioConcat.WriteString("ffconcat version 1.0\n")
		for _, seg := range segments {
			safePath := strings.ReplaceAll(filepath.ToSlash(seg.AudioSource), "'", "'\\''")
			audioConcat.WriteString(fmt.Sprintf("file '%s'\n", safePath))
			audioConcat.WriteString(fmt.Sprintf("inpoint %f\n", seg.InPoint))
			audioConcat.WriteString(fmt.Sprintf("outpoint %f\n", seg.OutPoint))
		}

		audioListPath := filepath.Join(tempDir, fmt.Sprintf("export_audio_list_%d.txt", time.Now().Unix()))
		os.WriteFile(audioListPath, []byte(audioConcat.String()), 0644)

		mainAudioOutput := filepath.Join(tempDir, fmt.Sprintf("temp_audio_main_%d.wav", time.Now().Unix()))
		// Render Main Audio
		if err := a.runFFmpegWithProgress([]string{"-y", "-f", "concat", "-safe", "0", "-i", audioListPath, "-c:a", "pcm_s16le", mainAudioOutput}, "Main Audio"); err != nil {
			return "Main Audio Error: " + err.Error()
		}

		type AudioOp struct {
			Source    string
			Start     float64 // Timeline start
			Duration  float64
			TrimStart float64 // Source offset
			Volume    float64
		}
		var audioOps []AudioOp

		// --- AUDIO FLATTENING LOGIC (The Fix) ---
		// Instead of just looping and adding, we slice time and let higher tracks overwrite lower ones.

		// 1. Gather all Audio-Only Tracks
		var audioTracks [][]Item
		audioTimePoints := []float64{0.0}

		for tIdx, rawTrack := range timeline.Tracks {
			// Check visibility & Type
			if tIdx < len(timeline.TrackSettings) {
				ts := timeline.TrackSettings[tIdx]
				if !ts.Visible {
					continue
				}
				// We only care about AUDIO tracks here (A1, A2...)
				isAudio := ts.Type == "audio" || strings.HasPrefix(ts.Name, "A")
				if !isAudio {
					continue
				}

				var track []Item
				for _, rawItem := range rawTrack {
					item := Item{}
					if v, ok := rawItem["startTime"].(float64); ok { item.StartTime = v }
					if v, ok := rawItem["duration"].(float64); ok { item.Duration = v }
					if v, ok := rawItem["trimStart"].(float64); ok { item.TrimStart = v }
					if v, ok := rawItem["outputVideo"].(string); ok { item.OutputVideo = v }
					if v, ok := rawItem["audioPath"].(string); ok { item.AudioPath = v }
					if v, ok := rawItem["pairId"].(string); ok { item.PairID = v }
					// Volume default
					item.Duration = item.Duration // hack to keep type
					
					// Add to our list
					track = append(track, item)

					// Collect Time Points
					audioTimePoints = append(audioTimePoints, item.StartTime)
					audioTimePoints = append(audioTimePoints, item.StartTime+item.Duration)
				}
				audioTracks = append(audioTracks, track)
			}
		}

		// 2. Sort and Unique Audio Time Points
		sort.Float64s(audioTimePoints)
		uniqueAudioPoints := []float64{}
		if len(audioTimePoints) > 0 {
			uniqueAudioPoints = append(uniqueAudioPoints, audioTimePoints[0])
			for i := 1; i < len(audioTimePoints); i++ {
				if audioTimePoints[i] > audioTimePoints[i-1]+0.001 {
					uniqueAudioPoints = append(uniqueAudioPoints, audioTimePoints[i])
				}
			}
		}

		// 3. Iterate Time Segments (Flattening)
		for i := 0; i < len(uniqueAudioPoints)-1; i++ {
			start := uniqueAudioPoints[i]
			end := uniqueAudioPoints[i+1]
			mid := (start + end) / 2
			dur := end - start

			var activeItem *Item

			// 4. Find the Winner for this segment
			// We iterate ALL audio tracks (0..N).
			// If we find a clip, we overwrite `activeItem`.
			// This means the LAST track (highest index, e.g. A2) will overwrite A1.
			for _, track := range audioTracks {
				for _, item := range track {
					if mid >= item.StartTime && mid < item.StartTime+item.Duration {
						// Special Case: Video-Paired Audio
						// If this audio is tied to a video, and that video was hidden (covered),
						// then this audio clip is NOT valid.
						if item.PairID != "" && !visiblePairIDs[item.PairID] {
							continue
						}

						itemCopy := item
						activeItem = &itemCopy
						break // Found the clip for THIS track, move to next track to see if it overwrites
					}
				}
			}

			// 5. Add to Ops
			if activeItem != nil {
				// Calculate trim
				offset := start - activeItem.StartTime + activeItem.TrimStart
				src := activeItem.OutputVideo
				if src == "" { src = activeItem.AudioPath }
				
				if src != "" {
					audioOps = append(audioOps, AudioOp{
						Source:    src,
						Start:     start, // Use segment start, not item start
						Duration:  dur,   // Use segment duration
						TrimStart: offset,
						Volume:    1.0, // Default volume
					})
				}
			}
		}

		if len(audioOps) > 0 {
			// Build Complex Filter Graph
			var args []string
			args = append(args, "-y")

			// Input 0 is Main Audio (from video tracks)
			args = append(args, "-i", mainAudioOutput)

			// Inputs 1..N are Extra Audio Clips
			for _, op := range audioOps {
				args = append(args, "-i", op.Source)
			}

			// Filter
			var filterComplex strings.Builder

			// Process Extra Audio Clips
			for i, op := range audioOps {
				inputIdx := i + 1
				delayMs := int(op.Start * 1000)
				// Use exact duration logic for cleaner cuts
				end := op.TrimStart + op.Duration
				
				// Apply Trim -> Reset Timestamp -> Delay -> Volume
				filterComplex.WriteString(fmt.Sprintf("[%d:a]atrim=start=%f:end=%f,asetpts=PTS-STARTPTS,adelay=%d|%d,volume=%f[a%d];",
					inputIdx, op.TrimStart, end, delayMs, delayMs, op.Volume, i))
			}

			// Mix
			filterComplex.WriteString("[0:a]")
			for i := 0; i < len(audioOps); i++ {
				filterComplex.WriteString(fmt.Sprintf("[a%d]", i))
			}
			// Normalize=0 prevents volume drop when mixing
			filterComplex.WriteString(fmt.Sprintf("amix=inputs=%d:dropout_transition=0:normalize=0[outa]", len(audioOps)+1))

			audioOutput = filepath.Join(tempDir, fmt.Sprintf("temp_audio_%d.m4a", time.Now().Unix()))

			args = append(args, "-filter_complex", filterComplex.String(), "-map", "[outa]", "-c:a", "aac", "-b:a", "192k", audioOutput)

			if err := a.runFFmpegWithProgress(args, "Audio"); err != nil {
				return "Audio Render Error: " + err.Error()
			}
		} else {
			// No extra audio, just convert main audio to AAC
			audioOutput = filepath.Join(tempDir, fmt.Sprintf("temp_audio_%d.m4a", time.Now().Unix()))
			if err := a.runFFmpegWithProgress([]string{"-y", "-i", mainAudioOutput, "-c:a", "aac", "-b:a", "192k", audioOutput}, "Audio Convert"); err != nil {
				return "Audio Convert Error: " + err.Error()
			}
		}
	}
	
	// --- MUX / FINALIZE ---
	runtime.EventsEmit(a.ctx, "export:status", "Finalizing...")

	finalArgs := []string{"-y"}

	if videoOutput != "" {
		finalArgs = append(finalArgs, "-i", videoOutput)
	}
	if audioOutput != "" {
		finalArgs = append(finalArgs, "-i", audioOutput)
	}

	if videoOutput == "" && audioOutput == "" {
		return "Nothing to export"
	}

	// 1. Handle Video Stream
	if videoOutput != "" {
		finalArgs = append(finalArgs, "-map", "0:v")
		finalArgs = append(finalArgs, "-c:v", "copy") // Copy the video we already rendered
	}

	// 2. Handle Audio Stream
	if audioOutput != "" {
		// If video exists, audio is input #1. If not, audio is input #0.
		idx := "0"
		if videoOutput != "" {
			idx = "1"
		}
		finalArgs = append(finalArgs, "-map", idx+":a")

		// --- AUDIO CODEC LOGIC ---
		// We must convert the temp audio (AAC) to the user's requested format.
		if options.Format == "mp3" {
			// Convert to MP3
			finalArgs = append(finalArgs, "-c:a", "libmp3lame", "-b:a", "320k")
		} else if options.Format == "wav" {
			// Convert to WAV (Uncompressed)
			finalArgs = append(finalArgs, "-c:a", "pcm_s16le")
		} else {
			// For Video (MP4/MOV/MKV), keeping the AAC audio is standard and fast.
			finalArgs = append(finalArgs, "-c:a", "copy")
		}
	}

	finalArgs = append(finalArgs, outPath)

	cmd := exec.Command("ffmpeg", finalArgs...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "Mux Error: " + string(out)
	}

	// Cleanup Temp Files
	if videoOutput != "" {
		os.Remove(videoOutput)
	}
	if audioOutput != "" {
		os.Remove(audioOutput)
	}

	runtime.EventsEmit(a.ctx, "export:progress", 100)
	return "Success"
}

func (a *App) runFFmpegWithProgress(args []string, label string) error {
	cmd := exec.Command("ffmpeg", args...)
	
	// Capture stderr for progress
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	
	if err := cmd.Start(); err != nil {
		return err
	}

	// Parse progress
	// FFmpeg outputs: "frame=  123 ... time=00:00:05.23 ..."
	// We can try to parse 'time=' to calculate percentage if we knew total duration,
	// but for now, let's just pulse or show activity, or try to parse time.
	// Since we don't easily know total duration inside this helper without passing it,
	// we will just emit the raw time string or a "working" event.
	
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Split(bufio.ScanLines)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "time=") {
				// Extract time
				re := regexp.MustCompile(`time=(\d{2}):(\d{2}):(\d{2}\.\d{2})`)
				matches := re.FindStringSubmatch(line)
				if len(matches) == 4 {
					// Just emit the raw string for the UI to display
					runtime.EventsEmit(a.ctx, "export:status", fmt.Sprintf("%s: %s:%s:%s", label, matches[1], matches[2], matches[3]))
				}
			}
		}
	}()

	return cmd.Wait()
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