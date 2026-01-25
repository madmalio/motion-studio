// frontend/lib/wailsSafe.ts
import * as App from "../wailsjs/go/main/App";
import { waitForWails } from "./wailsReady";

// One place to safely call any Wails Go method
async function callGo<T>(fn: () => Promise<T>, label: string): Promise<T> {
  await waitForWails(); // <-- prevents "reading main" crash
  try {
    return await fn();
  } catch (e) {
    console.error(`Wails call failed: ${label}`, e);
    throw e;
  }
}

// Export safe wrappers for the functions you use in Studio/Scenes
export const GetProject = (id: string) =>
  callGo(() => App.GetProject(id), "GetProject");
export const GetScenes = (id: string) =>
  callGo(() => App.GetScenes(id), "GetScenes");
export const GetShots = (p: string, s: string) =>
  callGo(() => App.GetShots(p, s), "GetShots");
export const SaveShots = (p: string, s: string, data: any) =>
  callGo(() => App.SaveShots(p, s, data), "SaveShots");
export const DeleteShot = (p: string, s: string, id: string) =>
  callGo(() => App.DeleteShot(p, s, id), "DeleteShot");

export const GetTimeline = (p: string, s: string) =>
  callGo(() => App.GetTimeline(p, s), "GetTimeline");
export const SaveTimeline = (p: string, s: string, data: any) =>
  callGo(() => App.SaveTimeline(p, s, data), "SaveTimeline");

export const ReadImageBase64 = (path: string) =>
  callGo(() => App.ReadImageBase64(path), "ReadImageBase64");
export const ExtractLastFrame = (path: string) =>
  callGo(() => App.ExtractLastFrame(path), "ExtractLastFrame");

// ---- SettingsProvider safe wrappers ----
export const GetComfyURL = () => callGo(() => App.GetComfyURL(), "GetComfyURL");
export const SetComfyURL = (url: string) =>
  callGo(() => App.SetComfyURL(url), "SetComfyURL");
export const TestComfyConnection = () =>
  callGo(() => App.TestComfyConnection(), "TestComfyConnection");

export const GetWorkflows = () =>
  callGo(() => App.GetWorkflows(), "GetWorkflows");
export const ImportWorkflow = (name: string) =>
  callGo(() => App.ImportWorkflow(name), "ImportWorkflow");
export const DeleteWorkflow = (id: string) =>
  callGo(() => App.DeleteWorkflow(id), "DeleteWorkflow");
export const RenameWorkflow = (id: string, newName: string) =>
  callGo(() => App.RenameWorkflow(id, newName), "RenameWorkflow");
