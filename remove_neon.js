const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'components');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Replace font-display
  content = content.replace(/font-display/g, '');
  
  // Replace font-mono
  content = content.replace(/font-mono/g, '');
  
  // Replace uppercase tracking-wider
  content = content.replace(/uppercase tracking-wider/g, '');
  
  // Replace neon shadows
  content = content.replace(/shadow-\[0_0_[^\]]+\]/g, 'shadow-sm');
  
  // Replace drop-shadows
  content = content.replace(/drop-shadow-\[0_0_[^\]]+\]/g, 'drop-shadow-sm');
  
  // Replace bg-card/80 backdrop-blur-xl with bg-card
  content = content.replace(/bg-card\/80 backdrop-blur-xl/g, 'bg-card');
  content = content.replace(/bg-card\/50 backdrop-blur-xl/g, 'bg-card');
  content = content.replace(/bg-background\/50 backdrop-blur-xl/g, 'bg-background');
  content = content.replace(/bg-background\/80 backdrop-blur-xl/g, 'bg-background');
  
  // Replace text-[#00FF00] with text-emerald-500
  content = content.replace(/text-\[#00FF00\]/g, 'text-emerald-500');
  
  // Replace bg-[#00FF00] with bg-emerald-500
  content = content.replace(/bg-\[#00FF00\]/g, 'bg-emerald-500');
  content = content.replace(/bg-\[#00FF00\]\/10/g, 'bg-emerald-500/10');
  content = content.replace(/bg-\[#00FF00\]\/20/g, 'bg-emerald-500/20');
  
  // Replace border-[#00FF00] with border-emerald-500
  content = content.replace(/border-\[#00FF00\]\/20/g, 'border-emerald-500/20');
  content = content.replace(/border-\[#00FF00\]\/30/g, 'border-emerald-500/30');
  content = content.replace(/border-\[#00FF00\]/g, 'border-emerald-500');

  // Replace hover:shadow-[#00FF00]/10 with hover:shadow-emerald-500/10
  content = content.replace(/hover:shadow-\[#00FF00\]\/10/g, 'hover:shadow-emerald-500/10');
  
  // Replace hover:border-[#00FF00]/30 with hover:border-emerald-500/30
  content = content.replace(/hover:border-\[#00FF00\]\/30/g, 'hover:border-emerald-500/30');

  // Clean up multiple spaces
  content = content.replace(/  +/g, ' ');
  content = content.replace(/ "/g, '"');
  content = content.replace(/" /g, '"');
  content = content.replace(/ className=""/g, '');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

function walkDir(currentPath) {
  const files = fs.readdirSync(currentPath);
  for (const file of files) {
    const filePath = path.join(currentPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
      processFile(filePath);
    }
  }
}

walkDir(dir);
console.log('Done');
