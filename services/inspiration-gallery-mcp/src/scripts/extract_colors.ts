import pg from 'pg';
import { Vibrant } from 'node-vibrant/node';
import chroma from 'chroma-js';
import * as dotenv from 'dotenv';
import path from 'path';

const defaultEnvFile = path.resolve(process.cwd(), '../../env/dev.env');
dotenv.config({ path: process.env.AIMODA_ENV_FILE || defaultEnvFile });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_DSN || 'postgresql://fashion:fashion_password@localhost:5432/fashion_chat',
});

interface PaletteColor {
  hex: string;
  percentage: number;
  hsv: { h: number; s: number; v: number };
}

async function extractColors() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT id, image_url 
      FROM gallery_images 
      WHERE colors = '[]'::jsonb OR colors IS NULL
      ORDER BY created_at DESC
    `);
    
    console.log(`Found ${rows.length} images needing color extraction.`);

    let count = 0;
    for (const row of rows) {
      count++;
      try {
        console.log(`[${count}/${rows.length}] Extracting colors for image ${row.id}...`);
        
        let imageUrl = row.image_url;
        // In case the image is on localhost, node-vibrant handles URLs, but for stability let's fetch it as buffer
        if (imageUrl.startsWith('http')) {
          // Force OSS to output JPG so Jimp/node-vibrant can parse it (WebP causes throwError)
          if (imageUrl.includes('aliyuncs.com')) {
            const separator = imageUrl.includes('?') ? '&' : '?';
            imageUrl += separator + 'x-oss-process=image/format,jpg';
          }
          const resp = await fetch(imageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
          });
          if (!resp.ok) {
            console.warn(`  Failed to fetch ${imageUrl}: ${resp.status} ${resp.statusText}`);
            continue;
          }
          const buffer = await resp.arrayBuffer();
          // Vibrant can extract from Buffer
          const palette = await Vibrant.from(Buffer.from(buffer)).getPalette();
          
          let totalPopulation = 0;
          for (const name in palette) {
            const swatch = palette[name as keyof typeof palette];
            if (swatch) {
              totalPopulation += swatch.population;
            }
          }

          const colors: PaletteColor[] = [];
          for (const name in palette) {
            const swatch = palette[name as keyof typeof palette];
            if (swatch) {
              const hex = swatch.hex;
              const [h, s, v] = chroma(hex).hsv();
              colors.push({
                hex,
                percentage: Number(((swatch.population / totalPopulation) * 100).toFixed(2)),
                hsv: {
                  h: isNaN(h) ? 0 : Math.round(h),
                  s: Math.round(s * 100),
                  v: Math.round(v * 100)
                }
              });
            }
          }

          // Sort by percentage descending
          colors.sort((a, b) => b.percentage - a.percentage);

          await client.query(`
            UPDATE gallery_images
            SET colors = $1
            WHERE id = $2
          `, [JSON.stringify(colors), row.id]);

          console.log(`  Saved ${colors.length} colors.`);
        }
      } catch (err) {
        console.error(`  Error processing image ${row.id}:`, err);
      }
    }
    
    console.log('Extraction complete!');
  } finally {
    client.release();
    await pool.end();
  }
}

extractColors().catch(console.error);
