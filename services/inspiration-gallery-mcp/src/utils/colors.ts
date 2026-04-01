import { Vibrant } from 'node-vibrant/node';
import chroma from 'chroma-js';

export interface PaletteColor {
  hex: string;
  percentage: number;
  hsv: { h: number; s: number; v: number };
}

/**
 * Extract dominant colors from an image buffer using node-vibrant and chroma-js.
 * @param buffer Image data buffer
 * @returns Array of PaletteColor sorted by percentage descending
 */
export async function extractColorsFromBuffer(buffer: Buffer): Promise<PaletteColor[]> {
  try {
    const palette = await Vibrant.from(buffer).getPalette();
    
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
    return colors;
  } catch (err) {
    console.warn('Failed to extract colors:', (err as Error).message);
    return [];
  }
}
