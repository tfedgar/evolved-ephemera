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

const sizes = [320, 640, 960, 1280, 1920];

async function optimizeImage(inputPath) {
  const filename = path.parse(inputPath).name;
  const stats = await fs.promises.stat(inputPath);
  
  // Skip if file is already optimized
  if (filename.includes('-optimized')) {
    return;
  }

  console.log(`Optimizing ${filename}...`);

  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();

    // Generate responsive images
    for (const size of sizes) {
      // Skip if target size is larger than original
      if (metadata.width && size > metadata.width) {
        continue;
      }

      // Generate WebP version
      const webpPath = join(outputDir, `${filename}-${size}.webp`);
      await image
        .resize(size, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
        .webp({
          quality: 80,
          effort: 6
        })
        .toFile(webpPath);
      console.log(`Generated ${size}px WebP`);

      // Generate JPEG version
      const jpegPath = join(outputDir, `${filename}-${size}.jpg`);
      await image
        .resize(size, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
        .jpeg({
          quality: 80,
          progressive: true,
          optimizeScans: true
        })
        .toFile(jpegPath);
      console.log(`Generated ${size}px JPEG`);
    }

    // Generate optimized original size
    const webpOriginal = join(outputDir, `${filename}-optimized.webp`);
    await image
      .webp({
        quality: 80,
        effort: 6
      })
      .toFile(webpOriginal);
    console.log(`Generated optimized WebP`);

    const jpegOriginal = join(outputDir, `${filename}-optimized.jpg`);
    await image
      .jpeg({
        quality: 80,
        progressive: true,
        optimizeScans: true
      })
      .toFile(jpegOriginal);
    console.log(`Generated optimized JPEG`);

  } catch (error) {
    console.error(`Error optimizing ${filename}:`, error);
  }
}

async function processDirectory() {
  try {
    const files = await fs.promises.readdir(inputDir);
    
    for (const file of files) {
      if (file.match(/\.(jpg|jpeg|png)$/i)) {
        await optimizeImage(join(inputDir, file));
      }
    }
    
    console.log('Image optimization complete!');
  } catch (error) {
    console.error('Error processing directory:', error);
  }
}

processDirectory(); 