import AdvancedMaterialScraper from './advanced-material-scraper.js';

// Quick start configurations
const QUICK_CONFIGS = {
    // Download everything (careful - this is a lot of data!)
    all: {},
    
    // Download only critical files (syllabus, PYQs)
    critical: {
        concurrentDownloads: 12,
        maxFileSize: 100 * 1024 * 1024, // 100MB
        priorityOnly: true
    },
    
    // Download specific branches
    cse: {
        branches: ['CSE', 'IT', 'AIDS', 'AIML'],
        concurrentDownloads: 10
    },
    
    engineering: {
        branches: ['MECH', 'CIVIL', 'EEE', 'ECE'],
        concurrentDownloads: 8
    },
    
    // Download first year only
    firstYear: {
        semesters: ['SEM1', 'SEM2'],
        concurrentDownloads: 15
    },
    
    // Test run - download a small subset
    test: {
        branches: ['CSE'],
        semesters: ['SEM1'],
        subjects: ['APP1'],
        concurrentDownloads: 5,
        maxFileSize: 50 * 1024 * 1024 // 50MB
    },
    
    // Resume previous download
    resume: {
        resume: true,
        concurrentDownloads: 10
    }
};

async function runQuickDownload(configName) {
    const config = QUICK_CONFIGS[configName];
    if (!config) {
        console.error(`❌ Unknown configuration: ${configName}`);
        console.log('Available configurations:', Object.keys(QUICK_CONFIGS).join(', '));
        return;
    }
    
    console.log(`🚀 Starting quick download with '${configName}' configuration...`);
    console.log('Configuration:', config);
    
    const scraper = new AdvancedMaterialScraper(config);
    await scraper.downloadAllMaterials();
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const configName = process.argv[2] || 'test';
    
    if (configName === '--help' || configName === '-h') {
        console.log(`
Material Scraper Quick Runner

Usage: node quick-scraper.js [configuration]

Available configurations:
  all         - Download everything (WARNING: Very large!)
  critical    - Download only critical files (syllabus, PYQs)
  cse         - Download CSE, IT, AIDS, AIML branches
  engineering - Download MECH, CIVIL, EEE, ECE branches
  firstYear   - Download only SEM1 and SEM2
  test        - Download a small test subset (CSE SEM1 APP1)
  resume      - Resume previous download

Default: test

Examples:
  node quick-scraper.js test
  node quick-scraper.js critical
  node quick-scraper.js resume
  node quick-scraper.js cse
        `);
        process.exit(0);
    }
    
    runQuickDownload(configName).catch(error => {
        console.error('💥 ERROR:', error);
        process.exit(1);
    });
}

export { runQuickDownload, QUICK_CONFIGS };
