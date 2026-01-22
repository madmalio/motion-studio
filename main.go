package main

import (
	"embed"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// --- UPDATED MIDDLEWARE ---
func FileLoaderMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(res http.ResponseWriter, req *http.Request) {
		
		// 1. Intercept /video/ requests
		if strings.HasPrefix(req.URL.Path, "/video/") {
			
			// 2. Get the raw path after /video/
			rawPath := strings.TrimPrefix(req.URL.Path, "/video/")
			
			// 3. Decode URL characters (e.g., %20 -> Space, %3A -> :)
			decodedPath, err := url.PathUnescape(rawPath)
			if err != nil {
				println("❌ [Middleware] URL Decode Error:", err.Error())
				http.Error(res, "Invalid path encoding", http.StatusBadRequest)
				return
			}

			// 4. CLEAN THE PATH FOR WINDOWS
			// Converts "C:/Users/Name/..." -> "C:\Users\Name\..."
			systemPath := filepath.FromSlash(decodedPath)

			// 5. DEBUG LOGS (Check your terminal!)
			println("🔍 [Middleware] Request:", rawPath)
			println("📂 [Middleware] Serving:", systemPath)

			// 6. Serve the file
			http.ServeFile(res, req, systemPath)
			return
		}

		// Pass everything else to the Wails frontend handler
		next.ServeHTTP(res, req)
	})
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Motion Studio",
		Width:  1024,
		Height: 768,
		
		// Ensure Middleware is registered
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: FileLoaderMiddleware, 
		},

		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			BackdropType:         windows.Mica,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  false,
				HideTitleBar:               false,
				FullSizeContent:            false,
				UseToolbar:                 false,
				HideToolbarSeparator:       true,
			},
			Appearance:           mac.NSAppearanceNameDarkAqua,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title:   "Motion Studio",
				Message: "AI Animation Station",
				Icon:    nil,
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}