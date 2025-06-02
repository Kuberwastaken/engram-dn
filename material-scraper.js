import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MaterialScraper {
    constructor() {
        this.materialsDir = path.resolve('./downloaded-materials');
        this.materialData = null;
        this.concurrentDownloads = 5; // Increased for faster downloads
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.maxRetries = 3;
        
        this.stats = {
            totalFiles: 0,
            downloadedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            errors: [],
            startTime: new Date().toISOString(),
            totalSize: 0,
            currentBatch: 0
        };        // Enhanced file type priorities - simplified since only dealing with JSONs and PDFs
        this.priorityExtensions = ['.pdf', '.json'];
        this.maxFileSize = Infinity; // No file size limit - download everything
        this.requestDelay = 50; // Reduced delay for faster downloads
        
        // Organize downloads by priority - simplified
        this.downloadsByPriority = {
            all: [] // All files treated equally
        };
    }

    async loadMaterialData() {
        try {
            console.log('📚 Loading material data from dotnotes-material.json...');
            const data = fs.readFileSync('./dotnotes-material.json', 'utf8');
            this.materialData = JSON.parse(data);
            console.log(`✅ Loaded material data with ${this.materialData.statistics.totalFiles} files`);
            this.stats.totalFiles = this.materialData.statistics.totalFiles;
            return true;
        } catch (error) {
            console.error('❌ Failed to load material data:', error.message);
            return false;
        }
    }

    sanitizeFileName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .substring(0, 200)
            .trim('_');
    }

    sanitizeFolderName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, ' ')
            .substring(0, 100)
            .trim();
    }    getFilePriority(fileName) {
        // No priority needed - all files are equal
        return 'all';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    printProgress() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles + this.stats.errorFiles;
        const percent = ((total / this.stats.totalFiles) * 100).toFixed(1);
        
        console.log(`📊 Progress: ${total}/${this.stats.totalFiles} (${percent}%) | ✅ ${this.stats.downloadedFiles} | ⏭️ ${this.stats.skippedFiles} | ❌ ${this.stats.errorFiles} | 💾 ${this.formatFileSize(this.stats.totalSize)}`);
    }

    async downloadFile(downloadUrl, filePath, fileName, retryCount = 0) {
        try {
            // Check if file already exists and has reasonable size
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > 100) {
                    this.stats.skippedFiles++;
                    if (this.stats.skippedFiles % 10 === 0) this.printProgress();
                    return { success: true, skipped: true };
                }
            }

            // Create directory if it doesn't exist
            fs.mkdirSync(path.dirname(filePath), { recursive: true });

            // Enhanced headers to avoid blocks
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            };

            // Get file info first
            const response = await axios.get(downloadUrl, {
                responseType: 'stream',
                timeout: 120000, // 2 minutes timeout
                headers,
                maxRedirects: 10
            });            const fileSize = parseInt(response.headers['content-length'] || 0);
            
            // Log file size info but don't skip any files
            if (fileSize > 0) {
                console.log(`📥 Downloading ${fileName} (${this.formatFileSize(fileSize)})`);
            }

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve) => {
                writer.on('finish', () => {
                    try {
                        const actualSize = fs.statSync(filePath).size;                        this.stats.totalSize += actualSize;
                        this.stats.downloadedFiles++;
                        
                        console.log(`✅ ${fileName} (${this.formatFileSize(actualSize)})`);
                        
                        if (this.stats.downloadedFiles % 5 === 0) this.printProgress();
                        resolve({ success: true, size: actualSize });
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
            if (retryCount < this.maxRetries) {
                console.log(`🔄 Retrying ${fileName} (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return this.downloadFile(downloadUrl, filePath, fileName, retryCount + 1);
            }

            console.log(`❌ Failed ${fileName}: ${error.message}`);
            this.stats.errorFiles++;
            this.stats.errors.push(`${fileName}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async processDownloadQueue() {
        console.log(`🚀 Starting downloads with ${this.concurrentDownloads} concurrent connections...`);
        
        const downloadPromises = [];
        
        while (this.downloadQueue.length > 0 || this.activeDownloads > 0) {
            // Fill up to max concurrent downloads
            while (downloadPromises.length < this.concurrentDownloads && this.downloadQueue.length > 0) {
                const downloadTask = this.downloadQueue.shift();
                this.activeDownloads++;
                
                const promise = this.downloadFile(
                    downloadTask.downloadUrl,
                    downloadTask.filePath,
                    downloadTask.fileName
                ).then(result => {
                    this.activeDownloads--;
                    return result;
                });
                
                downloadPromises.push(promise);
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, this.requestDelay));
            }
            
            // Wait for at least one download to complete
            if (downloadPromises.length > 0) {
                await Promise.race(downloadPromises);
                // Remove completed promises
                for (let i = downloadPromises.length - 1; i >= 0; i--) {
                    if (downloadPromises[i].isFulfilled) {
                        downloadPromises.splice(i, 1);
                    }
                }
            }
        }
        
        // Wait for all remaining downloads to complete
        await Promise.all(downloadPromises);
    }

    extractFilesFromData(data, branch = '', semester = '', subject = '', materialType = '') {
        const files = [];
        
        if (Array.isArray(data)) {
            for (const item of data) {
                if (item && typeof item === 'object') {
                    if (item.downloadUrl && item.name) {
                        // This is a file
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
                        // Recursively extract from nested objects
                        files.push(...this.extractFilesFromData(item, branch, semester, subject, materialType));
                    }
                }
            }
        } else if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
                if (key === 'downloadUrl' && data.name) {
                    // This object represents a file
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
        
        // Process branch-specific data
        if (this.materialData.branches) {
            for (const [branchName, branchData] of Object.entries(this.materialData.branches)) {
                for (const [semesterName, semesterData] of Object.entries(branchData)) {
                    for (const [subjectName, subjectData] of Object.entries(semesterData)) {
                        const files = this.extractFilesFromData(subjectData, branchName, semesterName, subjectName);
                        allFiles.push(...files);
                    }
                }
            }
        }
        
        // Process common semester cache
        if (this.materialData.commonSemesterCache) {
            for (const [semesterName, semesterData] of Object.entries(this.materialData.commonSemesterCache)) {
                for (const [subjectName, subjectData] of Object.entries(semesterData)) {
                    const files = this.extractFilesFromData(subjectData, 'COMMON', semesterName, subjectName);
                    allFiles.push(...files);
                }
            }
        }
        
        console.log(`📋 Found ${allFiles.length} total files to process`);
        
        // Create download tasks and organize by priority
        for (const file of allFiles) {
            if (!file.downloadUrl || !file.name) continue;
            
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
            
            const downloadTask = {
                downloadUrl: file.downloadUrl,
                filePath,
                fileName: file.name,
                branch: file.branch,
                semester: file.semester,
                subject: file.subject,
                materialType: file.materialType,
                priority: this.getFilePriority(file.name)
            };
              this.downloadsByPriority.all.push(downloadTask);
        }
        
        // All files treated equally now
        this.downloadQueue = [...this.downloadsByPriority.all];
        
        console.log(`📊 Download queue built:`);
        console.log(`   📁 Total files: ${this.downloadsByPriority.all.length} files`);
        console.log(`   🎯 Total queue: ${this.downloadQueue.length} files`);
        
        // Update total files count
        this.stats.totalFiles = this.downloadQueue.length;
    }

    async downloadAllMaterials() {
        console.log('🚀 MATERIAL SCRAPER STARTING...');
        console.log('='.repeat(60));
        
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
        }        console.log(`\n📊 Starting download of ${this.stats.totalFiles} files...`);
        console.log(`📁 File types: JSONs and PDFs (all treated equally)`);
        console.log(`💾 File size limit: NONE (downloading all files regardless of size)`);
        console.log(`🔄 Concurrent downloads: ${this.concurrentDownloads}`);
        console.log(`⏱️ Request delay: ${this.requestDelay}ms\n`);
        
        // Start downloading
        await this.processDownloadQueue();
        
        // Generate final report
        this.generateReport();
    }

    generateReport() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles + this.stats.errorFiles;
        const percent = total > 0 ? ((total / this.stats.totalFiles) * 100).toFixed(1) : '0.0';
        const duration = Math.round((Date.now() - new Date(this.stats.startTime)) / 1000 / 60);
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DOWNLOAD COMPLETED!');
        console.log('='.repeat(60));
        console.log(`✅ Successfully downloaded: ${this.stats.downloadedFiles.toLocaleString()} files`);
        console.log(`⏭️ Skipped (already exist): ${this.stats.skippedFiles.toLocaleString()} files`);
        console.log(`❌ Failed downloads: ${this.stats.errorFiles.toLocaleString()} files`);
        console.log(`📊 Total processed: ${total.toLocaleString()}/${this.stats.totalFiles.toLocaleString()} (${percent}%)`);
        console.log(`💾 Total downloaded size: ${this.formatFileSize(this.stats.totalSize)}`);
        console.log(`⏱️ Total duration: ${duration} minutes`);
        console.log(`⚡ Average speed: ${duration > 0 ? Math.round(this.stats.downloadedFiles / duration) : 0} files/minute`);
        
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
            averageSpeed: duration > 0 ? Math.round(this.stats.downloadedFiles / duration) : 0,
            errors: this.stats.errors,            completedAt: new Date().toISOString(),
            startedAt: this.stats.startTime,
            fileBreakdown: {
                total: this.downloadsByPriority.all.length
            }
        };
        
        fs.writeFileSync('./scraper-summary.json', JSON.stringify(summary, null, 2));
        console.log('\n📄 Detailed summary saved to scraper-summary.json');
        console.log(`📁 Downloaded files location: ${this.materialsDir}`);
        
        return summary;
    }
}

// Run the material scraper
const scraper = new MaterialScraper();
scraper.downloadAllMaterials().catch(error => {
    console.error('💥 CRITICAL ERROR:', error);
    console.error(error.stack);
    process.exit(1);
});

export default MaterialScraper;
