const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SmartDownloader {
  constructor() {
    this.batchSizeGB = parseFloat(process.env.BATCH_SIZE_GB || '10');
    this.batchSizeBytes = this.batchSizeGB * 1024 * 1024 * 1024;
    this.batchCounter = parseInt(fs.readFileSync('/tmp/batch_counter', 'utf8') || '0');
    this.totalCommits = parseInt(fs.readFileSync('/tmp/total_commits', 'utf8') || '0');
    this.sessionId = fs.readFileSync('/tmp/session_id', 'utf8').trim();
    this.lastBatchSize = 0;
    this.currentBatchSize = 0;
    this.checkInterval = 30000; // Check every 30 seconds
    this.lastCommitTime = Date.now();
    this.maxTimeBetweenCommits = 30 * 60 * 1000; // 30 minutes max
    this.rateLimitSize = 1.96 * 1024; // 1.96KB in bytes (Google Drive rate limit indicator)
    this.pausedForRateLimit = false;
    this.rateLimitPauseTime = 60 * 60 * 1000; // 1 hour pause
    this.rateLimitFiles = [];
  }

  checkForRateLimitFiles() {
    try {
      const materialDir = 'material';
      if (!fs.existsSync(materialDir)) return [];

      const rateLimitFiles = [];
      
      // Find all files that are exactly 1.96KB (rate limit indicator)
      const findRateLimitFiles = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            findRateLimitFiles(fullPath);
          } else if (Math.abs(stat.size - this.rateLimitSize) < 10) { // Allow 10 bytes tolerance
            rateLimitFiles.push({
              path: fullPath,
              size: stat.size,
              mtime: stat.mtime
            });
          }
        }
      };

      findRateLimitFiles(materialDir);
      return rateLimitFiles;
    } catch (error) {
      console.warn(`⚠️ Error checking for rate limit files: ${error.message}`);
      return [];
    }
  }

  async handleRateLimit() {
    const rateLimitFiles = this.checkForRateLimitFiles();
    
    if (rateLimitFiles.length === 0) {
      if (this.pausedForRateLimit) {
        console.log('✅ No rate limit files detected - resuming normal operation');
        this.pausedForRateLimit = false;
      }
      return false;
    }

    // New rate limit files detected
    const newRateLimitFiles = rateLimitFiles.filter(file => 
      !this.rateLimitFiles.some(existing => existing.path === file.path)
    );

    if (newRateLimitFiles.length > 0) {
      console.log(`\n🚫 GOOGLE DRIVE RATE LIMIT DETECTED!`);
      console.log(`📊 Found ${rateLimitFiles.length} files exactly 1.96KB (${newRateLimitFiles.length} new)`);
      
      // Log the rate limit files
      newRateLimitFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file.path} (${file.size} bytes, ${file.mtime.toISOString()})`);
      });

      // Remove rate limit files
      console.log('🗑️ Removing rate limit files...');
      let removedCount = 0;
      for (const file of rateLimitFiles) {
        try {
          fs.unlinkSync(file.path);
          removedCount++;
          console.log(`   ✅ Removed: ${file.path}`);
        } catch (error) {
          console.warn(`   ⚠️ Failed to remove ${file.path}: ${error.message}`);
        }
      }
      console.log(`🗑️ Removed ${removedCount}/${rateLimitFiles.length} rate limit files`);

      // Commit current progress before pausing
      console.log('💾 Committing progress before rate limit pause...');
      await this.commitBatch('rate limit detected');

      // Set pause state
      this.pausedForRateLimit = true;
      this.rateLimitStartTime = Date.now();
      this.rateLimitFiles = rateLimitFiles;

      console.log(`⏸️ PAUSING DOWNLOADER FOR 1 HOUR DUE TO GOOGLE DRIVE RATE LIMIT`);
      console.log(`⏰ Pause started at: ${new Date().toISOString()}`);
      console.log(`⏰ Resume scheduled for: ${new Date(Date.now() + this.rateLimitPauseTime).toISOString()}`);
      
      return true;
    }

    // Check if we're still in pause period
    if (this.pausedForRateLimit) {
      const pauseTimeElapsed = Date.now() - this.rateLimitStartTime;
      const remainingPause = this.rateLimitPauseTime - pauseTimeElapsed;
      
      if (remainingPause > 0) {
        const remainingMinutes = Math.ceil(remainingPause / (60 * 1000));
        console.log(`⏸️ Still paused for rate limit - ${remainingMinutes} minutes remaining`);
        return true;
      } else {
        console.log('⏰ Rate limit pause period completed - resuming downloads');
        this.pausedForRateLimit = false;
        return false;
      }
    }            return false;
  }

  getDirectorySize(dirPath) {
    try {
      const result = execSync(`du -sb "${dirPath}" 2>/dev/null | cut -f1`, { encoding: 'utf8' });
      return parseInt(result.trim()) || 0;
    } catch (error) {
      console.warn(`⚠️ Could not get directory size: ${error.message}`);
      return 0;
    }
  }

  async commitBatch(reason = 'size limit') {
    const currentSize = this.getDirectorySize('material');
    const sizeDiff = currentSize - this.lastBatchSize;
    
    if (sizeDiff < 100 * 1024 * 1024) { // Less than 100MB new data
      console.log(`📊 Skipping commit - only ${(sizeDiff / 1024 / 1024).toFixed(1)}MB new data`);
      return false;
    }

    console.log(`\n🔄 Committing batch #${this.batchCounter + 1} (${reason})`);
    console.log(`📊 Current batch size: ${(sizeDiff / 1024 / 1024 / 1024).toFixed(2)}GB`);
    console.log(`📊 Total directory size: ${(currentSize / 1024 / 1024 / 1024).toFixed(2)}GB`);

    try {
      // Check git status
      execSync('git status --porcelain', { stdio: 'pipe' });
      const hasChanges = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
      
      if (!hasChanges) {
        console.log('ℹ️ No changes to commit');
        return false;
      }

      // Add files
      console.log('📁 Adding files to git...');
      execSync('git add material/', { stdio: 'inherit' });
      execSync('git add -A', { stdio: 'inherit' });

      // Create commit
      const fileCount = this.getFileCount();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const commitMsg = `📚 🔄 BATCH #${this.batchCounter + 1}: Auto-download materials - ${fileCount.total} files (${(currentSize / 1024 / 1024 / 1024).toFixed(2)}GB) - PDF/JSON: ${fileCount.pdfJson} - ${timestamp} - Session: ${this.sessionId} - Reason: ${reason}`;
      
      execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
      console.log('✅ Commit created successfully');

      // Push changes
      console.log('📤 Pushing changes...');
      execSync('git push', { stdio: 'inherit' });
      console.log('✅ Changes pushed successfully');

      // Update counters
      this.batchCounter++;
      this.totalCommits++;
      this.lastBatchSize = currentSize;
      this.lastCommitTime = Date.now();
      
      fs.writeFileSync('/tmp/batch_counter', this.batchCounter.toString());
      fs.writeFileSync('/tmp/total_commits', this.totalCommits.toString());

      // Free up some memory and clean temp files
      if (global.gc) {
        global.gc();
      }

      return true;
    } catch (error) {
      console.error(`❌ Error during commit: ${error.message}`);
      return false;
    }
  }

  getFileCount() {
    try {
      const totalFiles = execSync('find material -type f | wc -l', { encoding: 'utf8' }).trim();
      const pdfJsonFiles = execSync('find material -type f \\( -name "*.pdf" -o -name "*.json" \\) | wc -l', { encoding: 'utf8' }).trim();
      return {
        total: parseInt(totalFiles) || 0,
        pdfJson: parseInt(pdfJsonFiles) || 0
      };
    } catch (error) {
      return { total: 0, pdfJson: 0 };
    }
  }

  async monitorAndCommit(downloaderProcess) {
    const monitor = setInterval(async () => {
      try {
        // First check for rate limiting
        const isRateLimited = await this.handleRateLimit();
        
        if (isRateLimited) {
          // If rate limited, pause the downloader process
          if (downloaderProcess && !downloaderProcess.killed) {
            console.log('⏸️ Pausing downloader process due to rate limit...');
            downloaderProcess.kill('SIGSTOP'); // Pause the process
          }
          return; // Skip other monitoring while paused
        } else {
          // Resume process if it was paused
          if (downloaderProcess && !downloaderProcess.killed && this.pausedForRateLimit === false) {
            try {
              downloaderProcess.kill('SIGCONT'); // Resume the process
            } catch (error) {
              // Process might not be paused, ignore error
            }
          }
        }

        const currentSize = this.getDirectorySize('material');
        const batchGrowth = currentSize - this.lastBatchSize;
        const timeSinceLastCommit = Date.now() - this.lastCommitTime;

        console.log(`📊 Monitor: Current size: ${(currentSize / 1024 / 1024 / 1024).toFixed(2)}GB, Batch growth: ${(batchGrowth / 1024 / 1024 / 1024).toFixed(2)}GB`);

        // Commit if we've reached the batch size limit
        if (batchGrowth >= this.batchSizeBytes) {
          console.log(`🎯 Batch size limit reached (${this.batchSizeGB}GB)`);
          await this.commitBatch('batch size limit');
        }
        // Or if too much time has passed since last commit (with substantial data)
        else if (timeSinceLastCommit >= this.maxTimeBetweenCommits && batchGrowth > 500 * 1024 * 1024) {
          console.log(`⏰ Time limit reached (30 minutes) with ${(batchGrowth / 1024 / 1024).toFixed(0)}MB new data`);
          await this.commitBatch('time limit');
        }

        // Check available disk space
        const availableBytes = parseInt(execSync("df / | awk 'NR==2{print $4}'", { encoding: 'utf8' }).trim()) * 1024;
        const availableGB = availableBytes / (1024 * 1024 * 1024);
        
        if (availableGB < 2) {
          console.log(`🚨 Low disk space: ${availableGB.toFixed(1)}GB remaining`);
          await this.commitBatch('low disk space');
        }

      } catch (error) {
        console.warn(`⚠️ Monitor error: ${error.message}`);
      }
    }, this.checkInterval);

    // Clean up monitor when process exits
    const cleanup = () => {
      clearInterval(monitor);
    };

    downloaderProcess.on('exit', cleanup);
    downloaderProcess.on('error', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);

    return monitor;
  }

  async run() {
    console.log(`🚀 Starting smart download with ${this.batchSizeGB}GB batch size`);
    console.log(`📊 Session ID: ${this.sessionId}`);
    console.log(`📊 Starting from batch #${this.batchCounter + 1}`);
    console.log(`🚫 Rate limit detection: Files exactly ${(this.rateLimitSize / 1024).toFixed(2)}KB will trigger 1-hour pause`);

    const downloaderProcess = spawn('node', ['advanced-material-scraper.js'], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });

    // Start monitoring
    const monitorInterval = await this.monitorAndCommit(downloaderProcess);

    return new Promise((resolve, reject) => {
      downloaderProcess.on('exit', async (code) => {
        clearInterval(monitorInterval);
        
        console.log(`\n📋 Download process finished with code: ${code}`);
        
        // Final check for rate limit files before committing
        const finalRateLimitFiles = this.checkForRateLimitFiles();
        if (finalRateLimitFiles.length > 0) {
          console.log(`🗑️ Final cleanup: Removing ${finalRateLimitFiles.length} rate limit files`);
          for (const file of finalRateLimitFiles) {
            try {
              fs.unlinkSync(file.path);
              console.log(`   ✅ Removed: ${file.path}`);
            } catch (error) {
              console.warn(`   ⚠️ Failed to remove ${file.path}: ${error.message}`);
            }
          }
        }
        
        // Final commit of any remaining data
        const finalCommitted = await this.commitBatch('final commit');
        
        const stats = {
          exitCode: code,
          totalCommits: this.totalCommits,
          finalSize: this.getDirectorySize('material'),
          finalCommitted,
          rateLimitPauses: this.rateLimitFiles.length > 0 ? 1 : 0,
          rateLimitFilesFound: this.rateLimitFiles.length
        };

        console.log(`\n📊 Final Stats:`);
        console.log(`   - Total commits: ${stats.totalCommits}`);
        console.log(`   - Final size: ${(stats.finalSize / 1024 / 1024 / 1024).toFixed(2)}GB`);
        console.log(`   - Rate limit pauses: ${stats.rateLimitPauses}`);
        console.log(`   - Rate limit files found: ${stats.rateLimitFilesFound}`);
        console.log(`   - Session: ${this.sessionId}`);

        resolve(stats);
      });

      downloaderProcess.on('error', (error) => {
        clearInterval(monitorInterval);
        reject(error);
      });
    });
  }
}

// Run the smart downloader
(async () => {
  try {
    const downloader = new SmartDownloader();
    const stats = await downloader.run();
    
    // Set GitHub outputs
    const exitCode = stats.exitCode || 0;
    const success = exitCode === 0 ? 'true' : (exitCode === 124 ? 'partial' : 'error');
    const completed = exitCode === 0 ? 'true' : 'false';
    
    console.log(`\n📤 Setting GitHub outputs:`);
    console.log(`   download_success=${success}`);
    console.log(`   download_completed=${completed}`);
    console.log(`   total_commits=${stats.totalCommits}`);
    console.log(`   rate_limit_pauses=${stats.rateLimitPauses || 0}`);
    
    // Write to GitHub outputs file
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      fs.appendFileSync(outputFile, `download_success=${success}\n`);
      fs.appendFileSync(outputFile, `download_completed=${completed}\n`);
      fs.appendFileSync(outputFile, `total_commits=${stats.totalCommits}\n`);
      fs.appendFileSync(outputFile, `rate_limit_pauses=${stats.rateLimitPauses || 0}\n`);
    }
    
    process.exit(exitCode);
  } catch (error) {
    console.error(`❌ Smart downloader error: ${error.message}`);
    process.exit(1);
  }
})();
