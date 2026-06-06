const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_BASE_URL = "https://tlkdd39jlb.execute-api.ap-south-1.amazonaws.com";
const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build_temp');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const ZIP_PATH = path.join(ROOT_DIR, 'frontend-deploy.zip');

// Clean and recreate temp build directory
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

console.log('1. Copying frontend files...');
// Copy src files
const srcDir = path.join(FRONTEND_DIR, 'src');
if (fs.existsSync(srcDir)) {
  copyRecursiveSync(srcDir, BUILD_DIR);
}

// Copy public files if they exist
const publicDir = path.join(FRONTEND_DIR, 'public');
if (fs.existsSync(publicDir)) {
  copyRecursiveSync(publicDir, BUILD_DIR);
}

console.log('2. Injecting API URL...');
const indexPath = path.join(BUILD_DIR, 'index.html');
if (fs.existsSync(indexPath)) {
  let indexContent = fs.readFileSync(indexPath, 'utf8');
  indexContent = indexContent.replace(/__AMPLIFY_API_URL__/g, API_BASE_URL);
  fs.writeFileSync(indexPath, indexContent, 'utf8');
  console.log(`Success: Injected API URL (${API_BASE_URL}) into index.html`);
} else {
  console.error('Error: index.html not found in build!');
  process.exit(1);
}

console.log('3. Zipping frontend files...');
// Create zip using PowerShell Compress-Archive
try {
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
  // Run compress command in PowerShell. We change directory to BUILD_DIR first to avoid zipping the parent folder.
  execSync(`powershell -Command "Set-Location -Path '${BUILD_DIR}'; Compress-Archive -Path * -DestinationPath '${ZIP_PATH}' -Force"`);
  console.log(`Success: ZIP file created at ${ZIP_PATH}`);
} catch (err) {
  console.error('Failed to create ZIP archive:', err.message);
  process.exit(1);
}

// Clean up
console.log('4. Cleaning up temporary folders...');
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
console.log('Done! Ready to upload to AWS Amplify.');

// Helper function
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}
