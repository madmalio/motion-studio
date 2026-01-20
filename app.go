package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Ensure base directory exists
	baseDir := a.getAppDir()
	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		os.MkdirAll(baseDir, 0755)
	}
}

// --- MODELS ---

type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Thumbnail string `json:"thumbnail"`
	UpdatedAt string `json:"updatedAt"`
}

type Scene struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	ShotCount int    `json:"shotCount"`
	UpdatedAt string `json:"updatedAt"`
}

type Shot struct {
	ID             string `json:"id"`
	SceneID        string `json:"sceneId"`
	Name           string `json:"name"`
	SourceImage    string `json:"sourceImage"`    // Path to input image
	Prompt         string `json:"prompt"`         // AI Prompt
	MotionStrength int    `json:"motionStrength"` // 1-127
	Seed           int64  `json:"seed"`
	Duration       int    `json:"duration"`       // Frames
	Status         string `json:"status"`         // DRAFT, RENDERING, DONE
	OutputVideo    string `json:"outputVideo"`    // Path to generated MP4
}

// --- HELPER FUNCTIONS ---

// getAppDir returns the path to "Documents/MotionStudio"
func (a *App) getAppDir() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, "Documents", "MotionStudio")
}

func (a *App) saveProjectFile(p Project) {
	projectPath := filepath.Join(a.getAppDir(), p.ID)
	data, _ := json.MarshalIndent(p, "", "  ")
	ioutil.WriteFile(filepath.Join(projectPath, "project.json"), data, 0644)
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
	data, err := ioutil.ReadFile(path)
	if err != nil {
		return p, err
	}
	err = json.Unmarshal(data, &p)
	return p, err
}

func (a *App) UpdateProject(p Project) {
	p.UpdatedAt = time.Now().Format("2006-01-02 15:04")
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
	ioutil.WriteFile(filepath.Join(sceneDir, "scene.json"), data, 0644)
	return s
}

func (a *App) GetScenes(projectId string) []Scene {
	scenesDir := filepath.Join(a.getAppDir(), projectId, "scenes")
	entries, _ := os.ReadDir(scenesDir)
	var scenes []Scene

	for _, entry := range entries {
		if entry.IsDir() {
			var s Scene
			data, err := ioutil.ReadFile(filepath.Join(scenesDir, entry.Name(), "scene.json"))
			if err == nil {
				json.Unmarshal(data, &s)
				// Count shots for the UI
				shots := a.GetShots(projectId, s.ID)
				s.ShotCount = len(shots)
				scenes = append(scenes, s)
			}
		}
	}
	return scenes
}

// --- SHOT FUNCTIONS ---

// SaveShots writes the list of shots to shots.json inside the scene folder
func (a *App) SaveShots(projectId string, sceneId string, shots []Shot) {
	path := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, "shots.json")
	data, _ := json.MarshalIndent(shots, "", "  ")
	ioutil.WriteFile(path, data, 0644)
}

// GetShots reads the list from disk
func (a *App) GetShots(projectId string, sceneId string) []Shot {
	path := filepath.Join(a.getAppDir(), projectId, "scenes", sceneId, "shots.json")
	
	data, err := ioutil.ReadFile(path)
	if err != nil {
		return []Shot{} 
	}

	var shots []Shot
	json.Unmarshal(data, &shots)
	return shots
}

func (a *App) CreateShot(sceneId string) Shot {
	return Shot{
		ID:             fmt.Sprintf("%d", time.Now().UnixNano()),
		SceneID:        sceneId,
		Name:           "New Shot",
		Status:         "DRAFT",
		MotionStrength: 127,
		Duration:       48,
	}
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
	bytes, err := ioutil.ReadFile(path)
	if err != nil {
		return ""
	}
	
	mimeType := "image/jpeg"
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".png" {
		mimeType = "image/png"
	} else if ext == ".webp" {
		mimeType = "image/webp"
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
		if err != nil { return "" }
		defer source.Close()

		destination, err := os.Create(outputPath)
		if err != nil { return "" }
		defer destination.Close()
		
		io.Copy(destination, source)
		return outputPath
	}

	// 2. If input is video, run FFmpeg
	// -sseof -3 : Seek to 3 seconds before the end
	// -i        : Input file
	// -update 1 : Overwrite existing
	// -q:v 1    : High quality output
	// -vframes 1: Capture exactly 1 frame
	cmd := exec.Command("ffmpeg", "-sseof", "-3", "-i", inputPath, "-update", "1", "-q:v", "1", "-vframes", "1", outputPath, "-y")
	
	err := cmd.Run()
	if err != nil {
		fmt.Printf("FFmpeg Error: %v\n", err)
		return ""
	}

	return outputPath
}