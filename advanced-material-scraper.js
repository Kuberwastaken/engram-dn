import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AdvancedMaterialScraper {
    constructor(options = {}) {
        this.materialsDir = path.resolve(options.outputDir || './downloaded-materials');
        this.materialData = null;
        this.concurrentDownloads = options.concurrentDownloads || 8;
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.maxRetries = options.maxRetries || 5;
        this.progressFile = './scraper-progress.json';
        this.resumeMode = options.resume || false;
        
        this.stats = {
            totalFiles: 0,
            downloadedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            errors: [],
            startTime: new Date().toISOString(),
            totalSize: 0,
            downloadSpeed: 0,
            estimatedTimeRemaining: 0
        };
          // Enhanced configuration
        this.config = {
            maxFileSize: Infinity, // No file size limit - download everything
            requestDelay: options.requestDelay || 25, // Faster for drive links
            chunkSize: 1024 * 1024, // 1MB chunks for progress tracking
            validateDownloads: options.validate || true,
            createMd5: options.createMd5 || false,
            skipExisting: options.skipExisting !== false, // Default true
            filterBranches: options.branches || null, // Filter specific branches
            filterSemesters: options.semesters || null, // Filter specific semesters
            filterSubjects: options.subjects || null, // Filter specific subjects
            dryRun: options.dryRun || false
        };
          // Download organization - simplified since priority isn't needed
        this.downloadsByPriority = {
            all: [] // All files treated equally
        };
        
        // Progress tracking
        this.progressTracker = {
            lastUpdate: Date.now(),
            downloadedInInterval: 0,
            intervalSize: 10000 // 10 seconds
        };
        
        // Initialize axios with better defaults
        this.axios = axios.create({
            timeout: 300000, // 5 minutes
            maxRedirects: 10,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1'
            }
        });
    }

    async loadMaterialData() {
        try {
            console.log('📚 Loading material data from dotnotes-material.json...');
            const data = fs.readFileSync('./dotnotes-material.json', 'utf8');
            this.materialData = JSON.parse(data);
            console.log(`✅ Loaded material data with ${this.materialData.statistics.totalFiles} total files`);
            console.log(`📊 Branches: ${this.materialData.statistics.totalBranches}`);
            console.log(`📊 Semesters: ${this.materialData.statistics.totalSemesters}`);
            console.log(`📊 Subjects: ${this.materialData.statistics.totalSubjects}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to load material data:', error.message);
            return false;
        }
    }

    loadProgress() {
        if (this.resumeMode && fs.existsSync(this.progressFile)) {
            try {
                const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                console.log(`🔄 Resume mode: Loading previous progress (${progress.completed.length} files completed)`);
                return progress;
            } catch (error) {
                console.log('⚠️ Could not load previous progress, starting fresh');
            }
        }
        return { completed: [], failed: [], lastSaved: null };
    }

    saveProgress() {
        const progress = {
            completed: this.completedFiles || [],
            failed: this.stats.errors,
            lastSaved: new Date().toISOString(),
            stats: this.stats
        };
        fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
    }

    sanitizeFileName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/[^\w\-_\.]/g, '_')
            .substring(0, 200)
            .trim('_');
    }

    sanitizeFolderName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/_{2,}/g, '_')
            .substring(0, 100)
            .trim();
    }    getFilePriority(fileName, materialType = '', subject = '') {
        // No priority needed - all files are equal
        return 'all';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
        return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    }

    updateProgressStats() {
        const now = Date.now();
        const timeDiff = (now - this.progressTracker.lastUpdate) / 1000;
        
        if (timeDiff >= 10) { // Update every 10 seconds
            const downloadRate = this.progressTracker.downloadedInInterval / timeDiff;
            this.stats.downloadSpeed = downloadRate;
            
            const remaining = this.stats.totalFiles - (this.stats.downloadedFiles + this.stats.skippedFiles + this.stats.errorFiles);
            this.stats.estimatedTimeRemaining = downloadRate > 0 ? remaining / downloadRate : 0;
            
            this.progressTracker.lastUpdate = now;
            this.progressTracker.downloadedInInterval = 0;
        }
    }

    printProgress() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles + this.stats.errorFiles;
        const percent = this.stats.totalFiles > 0 ? ((total / this.stats.totalFiles) * 100).toFixed(1) : '0.0';
        
        this.updateProgressStats();
        
        const eta = this.stats.estimatedTimeRemaining > 0 ? this.formatTime(this.stats.estimatedTimeRemaining) : 'calculating...';
        const speed = this.stats.downloadSpeed > 0 ? `${this.stats.downloadSpeed.toFixed(1)} files/s` : '0 files/s';
        
        console.log(`📊 ${total}/${this.stats.totalFiles} (${percent}%) | ✅${this.stats.downloadedFiles} ⏭️${this.stats.skippedFiles} ❌${this.stats.errorFiles} | 💾${this.formatFileSize(this.stats.totalSize)} | ⚡${speed} | ⏱️ETA: ${eta}`);
    }

    async validateFile(filePath, expectedSize = null) {
        if (!this.config.validateDownloads || !fs.existsSync(filePath)) return false;
        
        const stats = fs.statSync(filePath);
        
        // Basic size check
        if (stats.size < 100) return false;
        
        // Size validation if expected size is known
        if (expectedSize && Math.abs(stats.size - expectedSize) > expectedSize * 0.1) {
            return false; // More than 10% difference
        }
        
        return true;
    }

    async downloadFileWithProgress(downloadUrl, filePath, fileName, fileSize = null, retryCount = 0) {
        try {
            // Check if file already exists and is valid
            if (this.config.skipExisting && fs.existsSync(filePath)) {
                if (await this.validateFile(filePath, fileSize)) {
                    this.stats.skippedFiles++;
                    this.progressTracker.downloadedInInterval++;
                    return { success: true, skipped: true };
                } else {
                    // Remove invalid file
                    fs.unlinkSync(filePath);
                }
            }

            // Create directory
            fs.mkdirSync(path.dirname(filePath), { recursive: true });

            // Start download
            const response = await this.axios.get(downloadUrl, {
                responseType: 'stream',
                onDownloadProgress: (progressEvent) => {
                    // Could implement progress bar here for large files
                }
            });            const actualSize = parseInt(response.headers['content-length'] || 0);
            
            // Log file size but don't skip any files
            if (actualSize > 0) {
                console.log(`📥 Downloading ${fileName} (${this.formatFileSize(actualSize)})`);
            }

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve) => {
                writer.on('finish', async () => {
                    try {
                        // Validate downloaded file
                        if (await this.validateFile(filePath, actualSize)) {
                            const finalSize = fs.statSync(filePath).size;
                            this.stats.totalSize += finalSize;
                            this.stats.downloadedFiles++;
                            this.progressTracker.downloadedInInterval++;
                            
                            // Create MD5 hash if requested
                            let md5Hash = '';
                            if (this.config.createMd5) {
                                const fileBuffer = fs.readFileSync(filePath);
                                md5Hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
                                fs.writeFileSync(filePath + '.md5', md5Hash);
                            }
                              const priority = this.getFilePriority(fileName);
                            console.log(`✅ ${fileName} (${this.formatFileSize(finalSize)})`);
                            
                            if (this.stats.downloadedFiles % 5 === 0) {
                                this.printProgress();
                                this.saveProgress(); // Save progress periodically
                            }
                            
                            resolve({ success: true, size: finalSize, md5: md5Hash });
                        } else {
                            // File validation failed
                            fs.unlinkSync(filePath);
                            throw new Error('File validation failed');
                        }
                    } catch (error) {
                        console.log(`❌ Error finalizing ${fileName}: ${error.message}`);
                        this.stats.errorFiles++;
                        resolve({ success: false, error: error.message });
                    }
                });

                writer.on('error', (error) => {
                    console.log(`❌ Write error ${fileName}: ${error.message}`);
                    this.stats.errorFiles++;
                    this.stats.errors.push(`${fileName}: ${error.message}`);
                    resolve({ success: false, error: error.message });
                });
            });

        } catch (error) {
            if (retryCount < this.config.maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential backoff, max 30s
                console.log(`🔄 Retrying ${fileName} in ${delay/1000}s (${retryCount + 1}/${this.config.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.downloadFileWithProgress(downloadUrl, filePath, fileName, fileSize, retryCount + 1);
            }

            console.log(`❌ Failed ${fileName}: ${error.message}`);
            this.stats.errorFiles++;
            this.stats.errors.push(`${fileName}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async processDownloadQueue() {
        if (this.config.dryRun) {
            console.log('🔍 DRY RUN MODE - No files will be downloaded');
            for (const task of this.downloadQueue) {
                console.log(`📁 Would download: ${task.fileName} to ${task.filePath}`);
            }
            return;
        }

        console.log(`🚀 Starting downloads with ${this.concurrentDownloads} concurrent connections...`);
        
        const downloadPromises = [];
        let queueIndex = 0;
        
        while (queueIndex < this.downloadQueue.length || downloadPromises.length > 0) {
            // Fill up to max concurrent downloads
            while (downloadPromises.length < this.concurrentDownloads && queueIndex < this.downloadQueue.length) {
                const downloadTask = this.downloadQueue[queueIndex++];
                this.activeDownloads++;
                
                const promise = this.downloadFileWithProgress(
                    downloadTask.downloadUrl,
                    downloadTask.filePath,
                    downloadTask.fileName,
                    downloadTask.fileSize
                ).then(result => {
                    this.activeDownloads--;
                    return { ...result, task: downloadTask };
                });
                
                downloadPromises.push(promise);
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, this.config.requestDelay));
            }
            
            // Wait for at least one download to complete
            if (downloadPromises.length > 0) {
                const completed = await Promise.race(downloadPromises);
                const completedIndex = downloadPromises.findIndex(p => p === completed);
                downloadPromises.splice(completedIndex, 1);
            }
        }
    }

    extractFilesFromData(data, branch = '', semester = '', subject = '', materialType = '') {
        const files = [];
        
        if (Array.isArray(data)) {
            for (const item of data) {
                if (item && typeof item === 'object') {
                    if (item.downloadUrl && item.name) {
                        files.push({
                            name: item.name,
                            downloadUrl: item.downloadUrl,
                            viewUrl: item.viewUrl,
                            id: item.id,
                            branch,
                            semester,
                            subject,
                            materialType,
                            originalFolder: item.originalFolder || materialType
                        });
                    } else {
                        files.push(...this.extractFilesFromData(item, branch, semester, subject, materialType));
                    }
                }
            }
        } else if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
                if (key === 'downloadUrl' && data.name) {
                    files.push({
                        name: data.name,
                        downloadUrl: data.downloadUrl,
                        viewUrl: data.viewUrl,
                        id: data.id,
                        branch,
                        semester,
                        subject,
                        materialType,
                        originalFolder: data.originalFolder || materialType
                    });
                    break;
                } else if (Array.isArray(value) || (value && typeof value === 'object')) {
                    files.push(...this.extractFilesFromData(value, branch, semester, subject, key));
                }
            }
        }
        
        return files;
    }

    buildDownloadQueue() {
        console.log('🔍 Building download queue from material data...');
        
        const allFiles = [];
        const previousProgress = this.loadProgress();
        const completedFiles = new Set(previousProgress.completed);
        
        // Process branch-specific data
        if (this.materialData.branches) {
            for (const [branchName, branchData] of Object.entries(this.materialData.branches)) {
                // Filter branches if specified
                if (this.config.filterBranches && !this.config.filterBranches.includes(branchName)) {
                    continue;
                }
                
                for (const [semesterName, semesterData] of Object.entries(branchData)) {
                    // Filter semesters if specified
                    if (this.config.filterSemesters && !this.config.filterSemesters.includes(semesterName)) {
                        continue;
                    }
                    
                    for (const [subjectName, subjectData] of Object.entries(semesterData)) {
                        // Filter subjects if specified
                        if (this.config.filterSubjects && !this.config.filterSubjects.includes(subjectName)) {
                            continue;
                        }
                        
                        const files = this.extractFilesFromData(subjectData, branchName, semesterName, subjectName);
                        allFiles.push(...files);
                    }
                }
            }
        }
        
        // Process common semester cache
        if (this.materialData.commonSemesterCache) {
            for (const [semesterName, semesterData] of Object.entries(this.materialData.commonSemesterCache)) {
                if (this.config.filterSemesters && !this.config.filterSemesters.includes(semesterName)) {
                    continue;
                }
                
                for (const [subjectName, subjectData] of Object.entries(semesterData)) {
                    if (this.config.filterSubjects && !this.config.filterSubjects.includes(subjectName)) {
                        continue;
                    }
                    
                    const files = this.extractFilesFromData(subjectData, 'COMMON', semesterName, subjectName);
                    allFiles.push(...files);
                }
            }
        }
        
        console.log(`📋 Found ${allFiles.length} total files to process`);
        
        // Create download tasks and organize by priority
        for (const file of allFiles) {
            if (!file.downloadUrl || !file.name) continue;
            
            // Skip if already completed and in resume mode
            const fileKey = `${file.branch}_${file.semester}_${file.subject}_${file.name}`;
            if (this.resumeMode && completedFiles.has(fileKey)) {
                this.stats.skippedFiles++;
                continue;
            }
            
            const sanitizedFileName = this.sanitizeFileName(file.name);
            const branchFolder = this.sanitizeFolderName(file.branch || 'UNKNOWN');
            const semesterFolder = this.sanitizeFolderName(file.semester || 'UNKNOWN');
            const subjectFolder = this.sanitizeFolderName(file.subject || 'UNKNOWN');
            const materialFolder = this.sanitizeFolderName(file.originalFolder || file.materialType || 'MISC');
            
            const filePath = path.join(
                this.materialsDir,
                branchFolder,
                semesterFolder,
                subjectFolder,
                materialFolder,
                sanitizedFileName
            );
              const priority = this.getFilePriority(file.name, file.materialType, file.subject);
            const downloadTask = {
                downloadUrl: file.downloadUrl,
                filePath,
                fileName: file.name,
                branch: file.branch,
                semester: file.semester,
                subject: file.subject,
                materialType: file.materialType,
                priority,
                fileKey
            };
            
            this.downloadsByPriority.all.push(downloadTask);
        }
          // All files are treated equally now
        this.downloadQueue = [...this.downloadsByPriority.all];
        
        console.log(`📊 Download queue built:`);
        console.log(`   📁 Total files: ${this.downloadsByPriority.all.length} files`);
        console.log(`   🎯 Total queue: ${this.downloadQueue.length} files`);
        
        if (this.resumeMode && previousProgress.completed.length > 0) {
            console.log(`   🔄 Resumed from previous session (${previousProgress.completed.length} already completed)`);
        }
        
        this.stats.totalFiles = this.downloadQueue.length;
    }

    async downloadAllMaterials() {
        console.log('🚀 ADVANCED MATERIAL SCRAPER STARTING...');
        console.log('='.repeat(80));
        
        // Load material data
        if (!await this.loadMaterialData()) {
            console.error('❌ Failed to load material data. Exiting.');
            return;
        }
        
        // Build download queue
        this.buildDownloadQueue();
        
        if (this.downloadQueue.length === 0) {
            console.log('⚠️ No files found to download.');
            return;
        }
          console.log(`\n📊 Configuration:`);
        console.log(`   📁 Output directory: ${this.materialsDir}`);
        console.log(`   🔄 Concurrent downloads: ${this.concurrentDownloads}`);
        console.log(`   💾 File size limit: NONE (downloading all files regardless of size)`);
        console.log(`   ⏱️ Request delay: ${this.config.requestDelay}ms`);
        console.log(`   🔍 Validation: ${this.config.validateDownloads ? 'Enabled' : 'Disabled'}`);
        console.log(`   🆔 MD5 hashes: ${this.config.createMd5 ? 'Enabled' : 'Disabled'}`);
        console.log(`   ⏭️ Skip existing: ${this.config.skipExisting ? 'Enabled' : 'Disabled'}`);
        console.log(`   🔄 Resume mode: ${this.resumeMode ? 'Enabled' : 'Disabled'}`);
        
        if (this.config.filterBranches) {
            console.log(`   🎯 Filtered branches: ${this.config.filterBranches.join(', ')}`);
        }
        if (this.config.filterSemesters) {
            console.log(`   🎯 Filtered semesters: ${this.config.filterSemesters.join(', ')}`);
        }
        if (this.config.filterSubjects) {
            console.log(`   🎯 Filtered subjects: ${this.config.filterSubjects.join(', ')}`);
        }
        
        console.log(`\n🚀 Starting download of ${this.stats.totalFiles} files...\n`);
        
        // Start downloading
        await this.processDownloadQueue();
        
        // Final progress save
        this.saveProgress();
        
        // Generate final report
        this.generateReport();
        
        // Cleanup progress file if completed successfully
        if (this.stats.errorFiles === 0 && fs.existsSync(this.progressFile)) {
            fs.unlinkSync(this.progressFile);
            console.log('🧹 Progress file cleaned up (download completed successfully)');
        }
    }

    generateReport() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles + this.stats.errorFiles;
        const percent = this.stats.totalFiles > 0 ? ((total / this.stats.totalFiles) * 100).toFixed(1) : '0.0';
        const duration = Math.round((Date.now() - new Date(this.stats.startTime)) / 1000 / 60 * 100) / 100;
        
        console.log('\n' + '='.repeat(80));
        console.log('🎉 DOWNLOAD COMPLETED!');
        console.log('='.repeat(80));
        console.log(`✅ Successfully downloaded: ${this.stats.downloadedFiles.toLocaleString()} files`);
        console.log(`⏭️ Skipped (already exist): ${this.stats.skippedFiles.toLocaleString()} files`);
        console.log(`❌ Failed downloads: ${this.stats.errorFiles.toLocaleString()} files`);
        console.log(`📊 Total processed: ${total.toLocaleString()}/${this.stats.totalFiles.toLocaleString()} (${percent}%)`);
        console.log(`💾 Total downloaded size: ${this.formatFileSize(this.stats.totalSize)}`);
        console.log(`⏱️ Total duration: ${duration} minutes`);
        console.log(`⚡ Average speed: ${duration > 0 ? Math.round(this.stats.downloadedFiles / duration * 100) / 100 : 0} files/minute`);
        
        console.log(`\n📊 Priority breakdown:`);
        console.log(`   🔥 Critical: ${this.downloadsByPriority.critical.length} files`);
        console.log(`   ⭐ High: ${this.downloadsByPriority.high.length} files`);
        console.log(`   📄 Medium: ${this.downloadsByPriority.medium.length} files`);
        console.log(`   📁 Low: ${this.downloadsByPriority.low.length} files`);
        
        if (this.stats.errors.length > 0) {
            console.log(`\n⚠️ Errors encountered (${this.stats.errors.length}):`);
            this.stats.errors.slice(0, 10).forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
            if (this.stats.errors.length > 10) {
                console.log(`   ... and ${this.stats.errors.length - 10} more errors`);
            }
        }
        
        // Save detailed summary
        const summary = {
            totalFiles: this.stats.totalFiles,
            downloadedFiles: this.stats.downloadedFiles,
            skippedFiles: this.stats.skippedFiles,
            errorFiles: this.stats.errorFiles,
            totalSize: this.stats.totalSize,
            totalSizeFormatted: this.formatFileSize(this.stats.totalSize),
            duration: duration,
            averageSpeed: duration > 0 ? Math.round(this.stats.downloadedFiles / duration * 100) / 100 : 0,
            errors: this.stats.errors,
            completedAt: new Date().toISOString(),
            startedAt: this.stats.startTime,
            priorityBreakdown: {
                critical: this.downloadsByPriority.critical.length,
                high: this.downloadsByPriority.high.length,
                medium: this.downloadsByPriority.medium.length,
                low: this.downloadsByPriority.low.length
            },
            configuration: this.config,
            materialDataStats: this.materialData.statistics
        };
        
        const summaryPath = './advanced-scraper-summary.json';
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        console.log(`\n📄 Detailed summary saved to ${summaryPath}`);
        console.log(`📁 Downloaded files location: ${this.materialsDir}`);
        
        return summary;
    }
}

// CLI argument parsing
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        
        switch (arg) {
            case '--output-dir':
            case '-o':
                options.outputDir = nextArg;
                i++;
                break;
            case '--concurrent':
            case '-c':
                options.concurrentDownloads = parseInt(nextArg) || 8;
                i++;
                break;
            case '--max-size':
            case '-s':
                options.maxFileSize = parseInt(nextArg) * 1024 * 1024 || 1024 * 1024 * 1024; // MB to bytes
                i++;
                break;
            case '--branches':
            case '-b':
                options.branches = nextArg ? nextArg.split(',').map(b => b.trim()) : null;
                i++;
                break;
            case '--semesters':
                options.semesters = nextArg ? nextArg.split(',').map(s => s.trim()) : null;
                i++;
                break;
            case '--subjects':
                options.subjects = nextArg ? nextArg.split(',').map(s => s.trim()) : null;
                i++;
                break;
            case '--resume':
            case '-r':
                options.resume = true;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--no-validate':
                options.validate = false;
                break;
            case '--md5':
                options.createMd5 = true;
                break;
            case '--no-skip-existing':
                options.skipExisting = false;
                break;
            case '--help':
            case '-h':
                console.log(`
Advanced Material Scraper - Usage:

Options:
  -o, --output-dir <dir>     Output directory for downloads (default: ./downloaded-materials)
  -c, --concurrent <num>     Number of concurrent downloads (default: 8)
  -s, --max-size <mb>        Maximum file size in MB (default: 1024)
  -b, --branches <list>      Comma-separated list of branches to download
      --semesters <list>     Comma-separated list of semesters to download
      --subjects <list>      Comma-separated list of subjects to download
  -r, --resume               Resume from previous incomplete download
      --dry-run              Show what would be downloaded without downloading
      --no-validate          Disable file validation after download
      --md5                  Create MD5 hash files for downloaded files
      --no-skip-existing     Re-download existing files
  -h, --help                 Show this help message

Examples:
  node advanced-material-scraper.js
  node advanced-material-scraper.js --branches CSE,IT --semesters SEM1,SEM2
  node advanced-material-scraper.js --resume --concurrent 12
  node advanced-material-scraper.js --dry-run --subjects "Data Structures,Algorithms"
                `);
                process.exit(0);
        }
    }
    
    return options;
}

// Run the advanced scraper
if (import.meta.url === `file://${process.argv[1]}`) {
    const options = parseArgs();
    const scraper = new AdvancedMaterialScraper(options);
    
    scraper.downloadAllMaterials().catch(error => {
        console.error('💥 CRITICAL ERROR:', error);
        console.error(error.stack);
        process.exit(1);
    });
}

export default AdvancedMaterialScraper;
