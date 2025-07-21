import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inputDir = join(__dirname, '../public/images');
const outputDir = join(__dirname, '../public/images/optimized');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Define image dimensions based on their display sizes
const imageDimensions = {
  'coach': { width: 425, height: 448 },
  'testimonial1': { width: 400, height: 300 },
  'testimonial2': { width: 461, height: 300 },
  'testimonial3': { width: 429, height: 300 }
};

async function optimizeImage(inputPath) {
  const filename = path.parse(inputPath).name;
  
  // Skip if file is already optimized
  if (filename.includes('-optimized')) {
    return;
  }

  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    const dimensions = imageDimensions[filename] || { width: metadata.width, height: metadata.height };

    // Calculate responsive sizes
    const sizes = [
      dimensions.width,                     // 1x
      Math.round(dimensions.width * 2)      // 2x for high-DPI
    ].filter(size => size > 0 && size <= 1920);

    // Generate all versions in parallel
    const tasks = [];

    // Generate responsive images
    for (const size of sizes) {
      if (metadata.width && size > metadata.width) continue;

      const aspectRatio = dimensions.height / dimensions.width;
      const targetHeight = Math.round(size * aspectRatio);

      // WebP version
      tasks.push(
        image
          .clone()
          .resize(size, targetHeight, {
            withoutEnlargement: true,
            fit: 'cover'
          })
          .webp({
            quality: 80,
            effort: 4, // Balanced between speed and compression
            nearLossless: true // Better quality for Cloudflare's processing
          })
          .toFile(join(outputDir, `${filename}-${size}.webp`))
          .then(() => console.log(`✓ ${filename} ${size}px WebP`))
      );

      // JPEG version
      tasks.push(
        image
          .clone()
          .resize(size, targetHeight, {
            withoutEnlargement: true,
            fit: 'cover'
          })
          .jpeg({
            quality: 80,
            progressive: true,
            optimizeScans: true,
            mozjpeg: true,
            trellisQuantisation: true, // Better compression
            overshootDeringing: true, // Reduce ringing artifacts
            optimiseScans: true // Progressive rendering optimization
          })
          .toFile(join(outputDir, `${filename}-${size}.jpg`))
          .then(() => console.log(`✓ ${filename} ${size}px JPEG`))
      );
    }

    // Wait for all tasks to complete
    await Promise.all(tasks);
    console.log(`✅ ${filename} complete`);

  } catch (error) {
    console.error(`❌ Error optimizing ${filename}:`, error);
  }
}

async function processDirectory() {
  try {
    const files = await fs.promises.readdir(inputDir);
    const imageFiles = files.filter(file => file.match(/\.(jpg|jpeg|png)$/i));
    
    console.log(`\nOptimizing ${imageFiles.length} images...\n`);
    
    // Process all images in parallel
    await Promise.all(
      imageFiles.map(file => optimizeImage(join(inputDir, file)))
    );
    
    console.log('\n✨ Image optimization complete!\n');
  } catch (error) {
    console.error('\n❌ Error processing directory:', error);
  }
}

processDirectory(); 