package main

import (
	"embed"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// FileLoader handles loading local video files from disk
type FileLoader struct {
	http.Handler
}

func (h *FileLoader) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. Check if the request is for a video
	// The frontend will request: http://localhost:PORT/video/C:/Users/Mark/...
	if strings.HasPrefix(r.URL.Path, "/video/") {
		// 2. Extract the absolute file path
		// Remove the "/video/" prefix to get the real path on disk
		filePath := strings.TrimPrefix(r.URL.Path, "/video/")
		
		// 3. Serve the file efficiently (streams content, supports seeking/scrubbing)
		http.ServeFile(w, r, filePath)
		return
	}

	// If it's not a video, return 404 (Wails might handle fallback)
	w.WriteHeader(http.StatusNotFound)
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "motion-studio",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			// This handler is called when a file isn't found in "Assets" (dist folder)
			Handler: &FileLoader{}, 
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}