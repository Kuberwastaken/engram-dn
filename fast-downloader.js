import axios from 'axios';
import fs from 'fs';
import path from 'path';

class FastDownloader {
    constructor() {
        this.baseUrl = 'https://api.dotnotes.in';
        this.materialsDir = path.resolve('./material');
        
        // All branch IDs
        this.branches = {
            'AIDS': '1fH0uvhnXRsshqiDzHlR3WF2LVC7PfnQ7',
            'AIML': '13moTd7MZzBiAl-0xdUHEtF-xlV_OwlLz',
            'CIVIL': '1_OLVAfJQldM4F1F0QU9PBLL0gWXhnv66',
            'CSE': '12fczfGql33ZZH9LSFgxcrrOuIAKEzjdh',
            'ECE': '1Yo-MxG6locQ4lMKl07CN8lwqvnu-cWt3',
            'EEE': '1N-0kK34Qqme71MlznsslSE-RhiAaWRM1',
            'IT': '1u0nTa0WLf58jZ42zuLS7anUb7d_Nj99p',
            'MECH': '1XLxDgD7iJCbWZx7JbcuRDAfg2NPitVGV'
        };
        
        this.stats = {
            totalFiles: 2741,
            downloadedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            errors: [],
            startTime: new Date().toISOString(),
            totalSize: 0
        };
        
        this.commonSemestersDownloaded = false;
        this.maxDiskUsage = 10 * 1024 * 1024 * 1024; // 10GB limit
        this.currentDiskUsage = 0;
        
        // Priority file extensions (download these first)
        this.priorityExtensions = ['.pdf', '.docx', '.pptx', '.xlsx'];
        this.maxFileSize = 100 * 1024 * 1024; // 100MB per file limit
    }

    async makeRequest(url, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await axios.get(url, { 
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }                });
                await new Promise(resolve => setTimeout(resolve, 12.5));
                return response.data;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 250 * (i + 1)));
            }
        }
    }

    checkDiskSpace() {
        const used = this.getDiskUsage();
        const available = this.maxDiskUsage - used;
        
        console.log(`💾 Disk usage: ${this.formatFileSize(used)}/${this.formatFileSize(this.maxDiskUsage)} (${this.formatFileSize(available)} available)`);
        
        if (used > this.maxDiskUsage * 0.9) {
            console.log('⚠️  Approaching disk limit, stopping downloads');
            return false;
        }
        return true;
    }

    getDiskUsage() {
        try {
            if (fs.existsSync(this.materialsDir)) {
                const output = require('child_process').execSync(`du -sb "${this.materialsDir}"`, { encoding: 'utf8' });
                return parseInt(output.split('\t')[0]);
            }
        } catch (error) {
            console.log('Warning: Could not check disk usage');
        }
        return this.currentDiskUsage;
    }

    isPriorityFile(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        return this.priorityExtensions.includes(ext);
    }

    async downloadFile(downloadUrl, filePath, fileName) {
        try {
            // Check if file already exists and has reasonable size
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > 100) {
                    this.stats.skippedFiles++;
                    return true;
                }
            }

            // Check disk space before downloading
            if (!this.checkDiskSpace()) {
                console.log(`💾 Skipping ${fileName} - disk space limit reached`);
                return false;
            }

            // Get file size first to check if it's too large
            const headResponse = await axios.head(downloadUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const fileSize = parseInt(headResponse.headers['content-length'] || 0);
            
            // Skip very large files
            if (fileSize > this.maxFileSize) {
                console.log(`⏭️  Skipping ${fileName} - too large (${this.formatFileSize(fileSize)})`);
                this.stats.skippedFiles++;
                return true;
            }

            // Check if we have enough space for this file
            if (this.currentDiskUsage + fileSize > this.maxDiskUsage) {
                console.log(`💾 Skipping ${fileName} - would exceed disk limit`);
                return false;
            }

            const response = await axios.get(downloadUrl, {
                responseType: 'stream',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            fs.mkdirSync(path.dirname(filePath), { recursive: true });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    const size = fs.statSync(filePath).size;
                    const sizeStr = this.formatFileSize(size);
                    this.currentDiskUsage += size;
                    this.stats.totalSize += size;
                    
                    const priority = this.isPriorityFile(fileName) ? '⭐' : '  ';
                    console.log(`          ✅ ${priority} ${fileName} (${sizeStr})`);
                    this.stats.downloadedFiles++;
                    this.printProgress();
                    resolve(true);
                });
                writer.on('error', reject);
            });
        } catch (error) {
            console.log(`          ❌ Failed ${fileName}: ${error.message}`);
            this.stats.errorFiles++;
            this.stats.errors.push(`${fileName}: ${error.message}`);
            return false;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    printProgress() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles;
        const percent = ((total / this.stats.totalFiles) * 100).toFixed(1);
        if (total % 5 === 0) { // Print every 5 files to reduce logs
            console.log(`   📊 Progress: ${total}/${this.stats.totalFiles} (${percent}%) | Downloaded: ${this.stats.downloadedFiles} | Skipped: ${this.stats.skippedFiles} | Size: ${this.formatFileSize(this.stats.totalSize)}`);
        }
    }

    sanitizeFileName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 200);
    }

    async downloadAllFiles() {
        console.log('🚀 FAST DOWNLOADER STARTING...');
        console.log(`📊 Expected total files: ${this.stats.totalFiles.toLocaleString()}`);
        console.log(`💾 Disk limit: ${this.formatFileSize(this.maxDiskUsage)}`);
        console.log(`⭐ Priority extensions: ${this.priorityExtensions.join(', ')}\n`);
        
        // Process branches one at a time to manage memory
        for (const [branchName, branchId] of Object.entries(this.branches)) {
            console.log(`\n🎯 PROCESSING ${branchName} BRANCH...`);
            
            // Check if we should continue
            if (!this.checkDiskSpace()) {
                console.log(`💾 Stopping at ${branchName} - disk space limit reached`);
                break;
            }
            
            try {
                const semesters = await this.makeRequest(`${this.baseUrl}/getChild?id=${branchId}`);
                console.log(`   📊 Found ${semesters.length} semesters`);
                
                for (const semester of semesters) {
                    const semName = semester.name.toUpperCase();
                    
                    // Download SEM1 and SEM2 to COMMON folder only once
                    if (semName === 'SEM1' || semName === 'SEM2') {
                        if (!this.commonSemestersDownloaded) {
                            console.log(`\n   📚 ${semName} (COMMON)...`);
                            const success = await this.downloadSemesterFiles(semester, 'COMMON');
                            if (!success) break; // Stop if disk full
                        } else {
                            console.log(`   ⏭️  Skipping ${semName} (already in COMMON)`);
                        }
                        continue;
                    }
                    
                    console.log(`\n   📚 ${semName}...`);
                    const success = await this.downloadSemesterFiles(semester, branchName);
                    if (!success) break; // Stop if disk full
                }
                
                // Mark common semesters as downloaded after first branch
                if (!this.commonSemestersDownloaded) {
                    this.commonSemestersDownloaded = true;
                }
                
                console.log(`\n✅ COMPLETED ${branchName}!`);
                
            } catch (error) {
                console.log(`   ❌ FAILED ${branchName}: ${error.message}`);
                this.stats.errors.push(`Branch ${branchName}: ${error.message}`);
            }
        }
        
        this.generateReport();
    }

    async downloadSemesterFiles(semester, branchName) {
        try {
            const subjects = await this.makeRequest(`${this.baseUrl}/getChild?id=${semester.id}`);
            
            for (const subject of subjects) {
                console.log(`\n       📖 ${subject.name}`);
                
                const folders = await this.makeRequest(`${this.baseUrl}/getChild?id=${subject.id}`);
                
                for (const folder of folders) {
                    console.log(`         📁 ${folder.name}`);
                    
                    const files = await this.makeRequest(`${this.baseUrl}/getFiles?id=${folder.id}`);
                    
                    if (files.length === 0) continue;
                    
                    // Sort files by priority (PDFs, docs first)
                    const sortedFiles = files.sort((a, b) => {
                        const aPriority = this.isPriorityFile(a.name);
                        const bPriority = this.isPriorityFile(b.name);
                        if (aPriority && !bPriority) return -1;
                        if (!aPriority && bPriority) return 1;
                        return 0;
                    });
                    
                    const folderPath = path.join(
                        this.materialsDir,
                        branchName,
                        semester.name.toUpperCase(),
                        subject.name,
                        folder.name
                    );
                    
                    for (const file of sortedFiles) {
                        if (!file.url_download) continue;
                        
                        // Check disk space before each file
                        if (!this.checkDiskSpace()) {
                            console.log('💾 Disk space limit reached, stopping downloads');
                            return false;
                        }
                        
                        const sanitizedName = this.sanitizeFileName(file.name);
                        const filePath = path.join(folderPath, sanitizedName);
                        
                        const success = await this.downloadFile(file.url_download, filePath, file.name);
                        if (!success && !this.checkDiskSpace()) {
                            return false; // Stop if disk full
                        }                        
                        await new Promise(resolve => setTimeout(resolve, 9.25));
                    }
                }
            }
            return true;
        } catch (error) {
            console.log(`     ❌ Error in ${semester.name}: ${error.message}`);
            this.stats.errors.push(`Semester ${semester.name}: ${error.message}`);
            return true; // Continue with other semesters
        }
    }

    generateReport() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles;
        const percent = ((total / this.stats.totalFiles) * 100).toFixed(1);
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DOWNLOAD COMPLETED!');
        console.log('='.repeat(60));
        console.log(`✅ Downloaded: ${this.stats.downloadedFiles} files`);
        console.log(`⏭️  Skipped: ${this.stats.skippedFiles} files`);
        console.log(`❌ Errors: ${this.stats.errorFiles} files`);
        console.log(`📊 Total processed: ${total}/${this.stats.totalFiles} (${percent}%)`);
        console.log(`💾 Total size: ${this.formatFileSize(this.stats.totalSize)}`);
        console.log(`⏱️  Duration: ${Math.round((Date.now() - new Date(this.stats.startTime)) / 1000 / 60)} minutes`);
        
        if (this.stats.errors.length > 0) {
            console.log(`\n⚠️  ${this.stats.errors.length} errors occurred:`);
            this.stats.errors.slice(0, 5).forEach(error => console.log(`   • ${error}`));
            if (this.stats.errors.length > 5) {
                console.log(`   ... and ${this.stats.errors.length - 5} more errors`);
            }
        }
        
        // Save summary to file for GitHub Actions
        const summary = {
            downloadedFiles: this.stats.downloadedFiles,
            skippedFiles: this.stats.skippedFiles,
            errorFiles: this.stats.errorFiles,
            totalSize: this.stats.totalSize,
            errors: this.stats.errors.slice(0, 10), // First 10 errors only
            completedAt: new Date().toISOString()
        };
        
        fs.writeFileSync('./download-summary.json', JSON.stringify(summary, null, 2));
        console.log('\n📄 Summary saved to download-summary.json');
    }
}

// Run the fast downloader
const downloader = new FastDownloader();
downloader.downloadAllFiles().catch(error => {
    console.error('💥 ERROR:', error);
    process.exit(1);
});