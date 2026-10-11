# shellcheck shell=bash
# Node-ul cu care se construiește AdventShow pe VM-ul de Windows. Stă în folderul
# nostru de acolo (WIN_REPO\_node), nu e cel al sistemului: VM-ul e comun cu alte
# proiecte, iar Vite cere Node 20.19+. Inclus de build-win.sh și release.sh, după ce
# au citit signing.env și au definit WIN_SSH_OPTS.

VM_NODE_VERSION="24.21.0"
VM_NODE_DIR="${WIN_REPO}\\_node\\node-v${VM_NODE_VERSION}-win-x64"

# Îl descarcă doar dacă lipsește; altfel nu face nimic.
ensure_vm_node() {
  ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "if exist ${VM_NODE_DIR}\\node.exe (exit /b 0) else (powershell -NoProfile -Command \"\$ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force '${WIN_REPO}\\_node' | Out-Null; Invoke-WebRequest 'https://nodejs.org/dist/v${VM_NODE_VERSION}/node-v${VM_NODE_VERSION}-win-x64.zip' -OutFile '${WIN_REPO}\\_node\\node.zip'; Expand-Archive -Force '${WIN_REPO}\\_node\\node.zip' '${WIN_REPO}\\_node'; Remove-Item '${WIN_REPO}\\_node\\node.zip'\")"
}

# 0 doar dacă VM-ul răspunde cu exact versiunea cerută.
check_vm_node() {
  local v
  v=$(ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "${VM_NODE_DIR}\\node.exe -v" 2>/dev/null | tr -d '\r\n ')
  [ "$v" = "v${VM_NODE_VERSION}" ]
}
