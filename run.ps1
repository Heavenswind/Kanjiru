param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "")]
    [string]$Action = "start"
)

$ProjectRoot = $PSScriptRoot
$AndroidDir = "$ProjectRoot\android"
$Package = "com.kanjiapp"
$Activity = "$Package/.MainActivity"
$Port = 8081

function Start-App {
    Write-Host "Starting Metro..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot'; npx react-native start --reset-cache"

    Write-Host "Building and installing..."
    Push-Location $AndroidDir
    .\gradlew.bat app:installDebug -PreactNativeDevServerPort=$Port
    Pop-Location

    Write-Host "Launching app..."
    adb shell am start -n $Activity
}

function Stop-App {
    Write-Host "Stopping app..."
    adb shell am force-stop $Package

    Write-Host "Killing Metro..."
    npx kill-port $Port
}

switch ($Action) {
    "stop"  { Stop-App }
    default { Start-App }
}
