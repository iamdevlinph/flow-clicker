//go:build windows

package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "syscall"
    "time"
    "unsafe"
)

var (
    user32              = syscall.NewLazyDLL("user32.dll")
    kernel32            = syscall.NewLazyDLL("kernel32.dll")
    procSetWindowsHookEx = user32.NewProc("SetWindowsHookExW")
    procCallNextHookEx   = user32.NewProc("CallNextHookEx")
    procUnhookWindowsHookEx = user32.NewProc("UnhookWindowsHookEx")
    procGetMessage       = user32.NewProc("GetMessageW")
    procTranslateMessage = user32.NewProc("TranslateMessage")
    procDispatchMessage  = user32.NewProc("DispatchMessageW")
    procRegisterHotKey   = user32.NewProc("RegisterHotKey")
    procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
    procSetCursorPos     = user32.NewProc("SetCursorPos")
    procMouseEvent       = user32.NewProc("mouse_event")
    procGetModuleHandle  = kernel32.NewProc("GetModuleHandleW")
)

const (
    WH_MOUSE_LL = 14
    WM_LBUTTONDOWN = 0x0201
    WM_HOTKEY = 0x0312
    MOD_ALT = 0x0001
    MOD_CONTROL = 0x0002
    VK_F8 = 0x77
    VK_F9 = 0x78
    VK_F10 = 0x79
    VK_Q = 0x51
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
)

type POINT struct { X, Y int32 }
type MSLLHOOKSTRUCT struct { Pt POINT; MouseData uint32; Flags uint32; Time uint32; DwExtraInfo uintptr }
type MSG struct { Hwnd uintptr; Message uint32; WParam uintptr; LParam uintptr; Time uint32; Pt POINT; LPrivate uint32 }
type Click struct { X, Y int32; Delay time.Duration }

var (
    recording atomic.Bool
    playing atomic.Bool
    clicksMu sync.Mutex
    clicks []Click
    lastClick time.Time
    recordStart time.Time
)

func mouseHook(nCode int, wParam uintptr, lParam uintptr) uintptr {
    if nCode >= 0 && uint32(wParam) == WM_LBUTTONDOWN && recording.Load() && !playing.Load() {
        info := (*MSLLHOOKSTRUCT)(unsafe.Pointer(lParam))
        now := time.Now()
        base := lastClick
        if base.IsZero() { base = recordStart }
        delay := now.Sub(base)
        lastClick = now
        clicksMu.Lock()
        clicks = append(clicks, Click{X: info.Pt.X, Y: info.Pt.Y, Delay: delay})
        n := len(clicks)
        clicksMu.Unlock()
        fmt.Printf("  recorded #%d at %d,%d  delay=%dms\n", n, info.Pt.X, info.Pt.Y, delay.Milliseconds())
    }
    ret, _, _ := procCallNextHookEx.Call(0, uintptr(nCode), wParam, lParam)
    return ret
}

func toggleRecord() {
    if playing.Load() { fmt.Println("Cannot record while playing."); return }
    if recording.Swap(!recording.Load()) {
        fmt.Printf("Recording stopped. %d clicks captured.\n", countClicks())
    } else {
        recordStart = time.Now(); lastClick = time.Time{}
        fmt.Println("Recording started. Click anywhere; F8 stops.")
    }
}

func countClicks() int { clicksMu.Lock(); defer clicksMu.Unlock(); return len(clicks) }

func clearClicks() { clicksMu.Lock(); clicks = nil; clicksMu.Unlock(); fmt.Println("Flow cleared.") }

func play() {
    if recording.Load() { fmt.Println("Stop recording first (F8)."); return }
    if playing.Swap(true) { fmt.Println("Already playing."); return }
    clicksMu.Lock(); flow := append([]Click(nil), clicks...); clicksMu.Unlock()
    if len(flow) == 0 { playing.Store(false); fmt.Println("Nothing recorded yet."); return }
    go func() {
        defer playing.Store(false)
        fmt.Printf("Playing %d clicks with the physical Windows cursor...\n", len(flow))
        for i, c := range flow {
            time.Sleep(c.Delay)
            procSetCursorPos.Call(uintptr(c.X), uintptr(c.Y))
            time.Sleep(15 * time.Millisecond)
            procMouseEvent.Call(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.Sleep(30 * time.Millisecond)
            procMouseEvent.Call(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            fmt.Printf("  played #%d at %d,%d\n", i+1, c.X, c.Y)
        }
        fmt.Println("Playback finished.")
    }()
}

func main() {
    fmt.Println("FlowClicker Windows Physical Mouse Probe v2.0.0")
    fmt.Println("This is a smoke-test executable, not the full Tauri UI.")
    fmt.Println()
    fmt.Println("F8  = start/stop recording")
    fmt.Println("F9  = replay recorded clicks using the physical mouse")
    fmt.Println("F10 = clear flow")
    fmt.Println("Ctrl+Alt+Q = exit")
    fmt.Println()
    fmt.Println("Safety: playback moves and clicks the REAL cursor. Keep the target visible.")

    module, _, _ := procGetModuleHandle.Call(0)
    hook, _, err := procSetWindowsHookEx.Call(WH_MOUSE_LL, syscall.NewCallback(mouseHook), module, 0)
    if hook == 0 { fmt.Printf("Mouse hook failed: %v\n", err); return }
    defer procUnhookWindowsHookEx.Call(hook)

    procRegisterHotKey.Call(0, 1, 0, VK_F8)
    procRegisterHotKey.Call(0, 2, 0, VK_F9)
    procRegisterHotKey.Call(0, 3, 0, VK_F10)
    procRegisterHotKey.Call(0, 4, MOD_CONTROL|MOD_ALT, VK_Q)
    defer func(){ for i:=1;i<=4;i++ { procUnregisterHotKey.Call(0, uintptr(i)) } }()

    var msg MSG
    for {
        r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
        if int32(r) <= 0 { break }
        if msg.Message == WM_HOTKEY {
            switch msg.WParam {
            case 1: toggleRecord()
            case 2: play()
            case 3: clearClicks()
            case 4: fmt.Println("Exiting."); return
            }
            continue
        }
        procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
        procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
    }
}
