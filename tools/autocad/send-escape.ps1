param(
  [Parameter(Mandatory = $true)][int]$TargetProcessId,
  [int]$DelayMs = 900
)

$ErrorActionPreference = 'Stop'
Start-Sleep -Milliseconds $DelayMs
$null = Get-Process -Id $TargetProcessId -ErrorAction Stop

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F019Escape {
  public delegate bool ChildCallback(IntPtr window, IntPtr state);
  public delegate bool WindowCallback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(WindowCallback callback, IntPtr state);
  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr parent, ChildCallback callback, IntPtr state);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr key, IntPtr state);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  private static void SendEscape(IntPtr window) {
    PostMessage(window, 0x0100, (IntPtr)0x1B, IntPtr.Zero);
    PostMessage(window, 0x0102, (IntPtr)0x1B, IntPtr.Zero);
    PostMessage(window, 0x0101, (IntPtr)0x1B, IntPtr.Zero);
  }
  public static int CancelProcess(uint targetProcessId) {
    int count = 0;
    WindowCallback topLevel = (window, state) => {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId != targetProcessId) return true;
      count++;
      SendEscape(window);
      ChildCallback child = (childWindow, childState) => {
        count++;
        SendEscape(childWindow);
        return true;
      };
      EnumChildWindows(window, child, IntPtr.Zero);
      return true;
    };
    EnumWindows(topLevel, IntPtr.Zero);
    return count;
  }
}
'@

$windows = [F019Escape]::CancelProcess([uint32]$TargetProcessId)
if ($windows -le 0) { throw "AutoCAD automation process $TargetProcessId had no windows to cancel." }
