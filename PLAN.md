# PLAN.md: Audio Track Implementation for SimpleTimeline

## Current State Analysis

The timeline already supports:
- **Video tracks** as default (type: `"video"`)
- **Audio tracks** exist in the type definition (type: `"audio"`) with initial track created in `page.tsx` (line 219)
- Track-level functions: mute, visibility (hide), lock, and delete
- Clip-level functions: mute, split, delete
- Drag-and-drop from library
- Context menus for tracks and clips

## Implementation Requirements

Add functionality to **create and manage audio tracks** below video tracks with all the same controls as video tracks.

## Changes Required

### 1. SimpleTimeline.tsx (`frontend/components/studio/SimpleTimeline.tsx`)

**No major changes needed** - the component already supports audio tracks through:
- `TimelineTrack.type: "video" | "audio" | "text"` (line 54)
- `TimelineClip` supports `isMuted` property (line 48)
- Audio clips rendered differently with line waveform visualization (lines 473-493)
- Track context menus already handle mute/visibility/delete for all track types
- Clip context menus work for audio clips

**Potential improvements:**
- Audio track header styling could be more distinct
- Consider adding track type indicator in track headers
- Current visual differentiation: audio clips use `bg-[#1a1a1c]` vs video `bg-[#375a6c]`

### 2. page.tsx (`frontend/app/studio/page.tsx`)

**Current state:**
- Line 217-220: Default tracks include one video track and one audio track
- The `addTrack` button in SimpleTimeline calls `addTrack` function (line 729 in SimpleTimeline.tsx)
- `addTrack` currently hardcodes `type: "video"` (line 736)

**Required changes:**

#### Add Audio Track Button Functionality

**Option A: Add separate "Add Audio Track" button**
- Add "Add Audio Track" button alongside "Add Track"
- Creates track with `type: "audio"`
- Positions below existing tracks

**Option B: Add track type selector to "Add Track" button**
- Make "Add Track" button a dropdown/segmented control
- Options: "Video Track" | "Audio Track"
- User selects type before creating

**Option C: Automatic audio track creation**
- When first video clip is dropped, auto-create audio track if none exists
- Simpler UX but less control

**Option D: Two separate buttons (RECOMMENDED)**
- Replace single "Add Track" button with two buttons:
  - "Add Video Track" - creates video track
  - "Add Audio Track" - creates audio track
- Clear, explicit user intent
- Matches the existing UI style

**Implementation Plan:**

**Step 2a: Update addTrack function in SimpleTimeline.tsx**
- Change function signature to accept `trackType` parameter
- Default to `"video"` for backward compatibility
- Update track naming to include type-specific prefixes

**Step 2b: Update toolbar in page.tsx**
- Replace the single "Add Track" button (line 1494) with two buttons
- Button 1: "Add Video Track"
- Button 2: "Add Audio Track"
- Both use the same `addTrack` callback with different type parameters

### 3. Optional Enhancements

#### A. Track Type Visual Indicators
Add subtle visual cues in track headers:
- Audio tracks: blue dot indicator
- Video tracks: green dot indicator
- Makes track types immediately recognizable

#### B. Audio-Only Track Grouping
- Audio tracks could be visually grouped after video tracks
- Minor horizontal separator between video and audio sections
- Only needed if multiple audio tracks are common

#### C. Audio Clip Drag & Drop
**Current state:** Library drags shots (which contain audio paths)
**Enhancement:** Allow dragging audio files directly to audio tracks

This would require:
- Library component to support audio file types
- Drop handler in SimpleTimeline to check clip type
- Possibly new clip type: `ClipType = "video" | "audio" | "image" | "text" | "solid"` (line 35 already supports "audio")

## Testing Checklist

After implementation, verify:
- [ ] "Add Audio Track" button appears and works
- [ ] Audio track created with proper naming (Audio 1, Audio 2, etc.)
- [ ] Audio tracks appear below video tracks
- [ ] Track mute button works for audio tracks
- [ ] Track hide/show works for audio tracks
- [ ] Track delete works for audio tracks
- [ ] Audio clip mute works
- [ ] Audio clip split works
- [ ] Audio clip delete works
- [ ] Audio clips can be dragged from library to audio tracks
- [ ] Audio clips snap and quantize correctly
- [ ] Volume controls affect audio tracks
- [ ] Context menu works for audio tracks
- [ ] Audio track locking works

## Implementation Steps

1. **Update `addTrack` function in SimpleTimeline.tsx:**
   - Add `trackType` parameter (default: `"video"`)
   - Update naming logic for different track types
   - Line 729-744

2. **Update "Add Track" button in SimpleTimeline.tsx:**
   - Replace single button with two buttons
   - "Add Video Track" calls `addTrack("video")`
   - "Add Audio Track" calls `addTrack("audio")`
   - Line ~1494

3. **(Optional) Add track type visual indicators:**
   - Add colored dot in track header
   - Audio = blue, Video = green
   - Line ~305

4. **(Optional) Add track type separator:**
   - Between video and audio tracks for visual grouping
   - Minor horizontal line or background change

5. **Test all operations on audio tracks:**
   - Create new audio tracks
   - Add clips to audio tracks
   - Mute/unmute tracks
   - Hide/show tracks
   - Delete tracks
   - Manipulate clips (move, resize, split, delete, mute)

6. **Update documentation:**
   - Update AGENTS.md if new conventions established
   - Update component if props change

## Notes

- No changes to drag-and-drop logic needed - already supports audio clips
- No changes to timeline rendering needed - already handles audio track type
- No changes to context menus needed - already generic
- Type safety maintained through existing TypeScript interfaces
- Audio track support was partially implemented (initial track exists) but no way to add more audio tracks

## Estimated Files Modified

1. `frontend/components/studio/SimpleTimeline.tsx` - Main implementation
2. `frontend/app/studio/page.tsx` - Optional: if new button placement needed

## Estimated Lines Changed

- SimpleTimeline.tsx: ~20 lines (addTrack function + toolbar)
- page.tsx: ~0 lines (existing buttons can be reused or modified)