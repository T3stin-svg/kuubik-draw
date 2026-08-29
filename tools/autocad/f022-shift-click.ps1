param(
  [Parameter(Mandatory = $true)][long]$MainWindowHandle,
  [Parameter(Mandatory = $true)][int]$ExpectedProcessId,
  [ValidateSet('ShiftClick','Escape')][string]$Action = 'ShiftClick',
  [int]$ScreenX = -1,
  [int]$ScreenY = -1,
  [int]$DelayMilliseconds = 1000
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class F022PhysicalInput {
  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const ushort VK_SHIFT = 0x10;
  private const ushort VK_RETURN = 0x0D;
  private const uint KEYEVENTF_KEYUP = 0x0002;

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public INPUTUNION value;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint flags;
    public uint time;
    public IntPtr extraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public IntPtr extraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr window);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  private static INPUT Key(ushort key, bool up) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      value = new INPUTUNION { keyboard = new KEYBDINPUT { virtualKey = key, flags = up ? KEYEVENTF_KEYUP : 0 } }
    };
  }

  private static INPUT Mouse(uint flags) {
    return new INPUT {
      type = INPUT_MOUSE,
      value = new INPUTUNION { mouse = new MOUSEINPUT { flags = flags } }
    };
  }

  private static void Send(params INPUT[] inputs) {
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "SendInput did not deliver the complete input sequence.");
  }

  private static void EnsureForeground(IntPtr window, uint expectedProcessId) {
    IntPtr foreground = GetForegroundWindow();
    uint actualProcessId;
    GetWindowThreadProcessId(foreground, out actualProcessId);
    if (foreground != window || actualProcessId != expectedProcessId) {
      throw new InvalidOperationException(String.Format(
        "Refusing global input: foreground HWND/PID {0}/{1} does not match owned AutoCAD {2}/{3}.",
        foreground.ToInt64(), actualProcessId, window.ToInt64(), expectedProcessId));
    }
  }

  private static IntPtr ActivateOwned(long mainWindowHandle, uint expectedProcessId) {
    IntPtr window = new IntPtr(mainWindowHandle);
    if (!SetForegroundWindow(window)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "AutoCAD could not be foregrounded.");
    System.Threading.Thread.Sleep(200);
    EnsureForeground(window, expectedProcessId);
    return window;
  }

  private static void SafeKeyPress(IntPtr window, uint expectedProcessId, ushort key) {
    EnsureForeground(window, expectedProcessId);
    bool keyDown = false;
    try {
      Send(Key(key, false));
      keyDown = true;
    } finally {
      if (keyDown) Send(Key(key, true));
    }
  }

  public static void ShiftClickAndEnter(long mainWindowHandle, uint expectedProcessId, int x, int y) {
    IntPtr window = ActivateOwned(mainWindowHandle, expectedProcessId);
    if (!SetCursorPos(x, y)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Cursor could not be positioned over the AutoCAD model viewport.");
    System.Threading.Thread.Sleep(150);
    EnsureForeground(window, expectedProcessId);
    bool shiftDown = false;
    bool mouseDown = false;
    try {
      Send(Key(VK_SHIFT, false));
      shiftDown = true;
      System.Threading.Thread.Sleep(200);
      EnsureForeground(window, expectedProcessId);
      Send(Mouse(MOUSEEVENTF_LEFTDOWN));
      mouseDown = true;
      System.Threading.Thread.Sleep(80);
      EnsureForeground(window, expectedProcessId);
      Send(Mouse(MOUSEEVENTF_LEFTUP));
      mouseDown = false;
    } finally {
      try {
        if (mouseDown) Send(Mouse(MOUSEEVENTF_LEFTUP));
      } finally {
        if (shiftDown) Send(Key(VK_SHIFT, true));
      }
    }
    System.Threading.Thread.Sleep(150);
    SafeKeyPress(window, expectedProcessId, VK_RETURN);
  }

  public static void EscapeOwned(long mainWindowHandle, uint expectedProcessId) {
    IntPtr window = ActivateOwned(mainWindowHandle, expectedProcessId);
    SafeKeyPress(window, expectedProcessId, 0x1B);
    SafeKeyPress(window, expectedProcessId, 0x1B);
  }
}
'@

if ($ExpectedProcessId -le 0) { throw 'F-022 expected AutoCAD process id must be positive.' }
if ($Action -eq 'ShiftClick' -and ($ScreenX -lt 0 -or $ScreenY -lt 0)) { throw 'F-022 screen coordinates must be non-negative.' }
Start-Sleep -Milliseconds $DelayMilliseconds
[string]$kind = ''
if ($Action -eq 'ShiftClick') {
  [F022PhysicalInput]::ShiftClickAndEnter($MainWindowHandle, [uint32]$ExpectedProcessId, $ScreenX, $ScreenY)
  $kind = 'physical-shift-click'
} else {
  [F022PhysicalInput]::EscapeOwned($MainWindowHandle, [uint32]$ExpectedProcessId)
  $kind = 'owned-escape'
}
[ordered]@{
  schemaVersion = 1
  kind = $kind
  mainWindowHandle = $MainWindowHandle
  expectedProcessId = $ExpectedProcessId
  screen = @($ScreenX, $ScreenY)
  status = 'PASS'
} | ConvertTo-Json -Compress
