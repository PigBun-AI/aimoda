import { getOssThumbnailUrl } from '@/features/chat/oss-image'

export type CoverAsset = {
  filename: string
  alt: string
  className: string
  delay: string
  width: number
  height: number
  sizes: string
  preferredWidth: number
}

const REMOTE_COVER_BASE_URL = (import.meta.env.VITE_COVER_ASSET_BASE_URL || '').trim().replace(/\/$/, '')

function encodeFilename(filename: string): string {
  return filename
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function buildRemoteAssetUrl(filename: string): string {
  return `${REMOTE_COVER_BASE_URL}/${encodeFilename(filename)}`
}

function buildLocalOriginalUrl(filename: string): string {
  return `/cover/${encodeFilename(filename)}`
}

function buildLocalOptimizedUrl(filename: string): string {
  const optimizedFilename = filename.replace(/\.[^.]+$/, '.webp')
  return `/cover/optimized/${encodeFilename(optimizedFilename)}`
}

function buildWebpUrl(filename: string, width: number): string {
  if (REMOTE_COVER_BASE_URL) {
    return getOssThumbnailUrl(buildRemoteAssetUrl(filename), width)
  }

  return buildLocalOptimizedUrl(filename)
}

function buildFallbackUrl(filename: string): string {
  if (REMOTE_COVER_BASE_URL) {
    return buildRemoteAssetUrl(filename)
  }

  return buildLocalOriginalUrl(filename)
}

function buildSrcSet(filename: string, widths: number[]): string | undefined {
  if (!REMOTE_COVER_BASE_URL) {
    return undefined
  }

  return widths.map((width) => `${buildWebpUrl(filename, width)} ${width}w`).join(', ')
}

export function getCoverImageSources(filename: string, preferredWidth: number, responsiveWidths?: number[]) {
  return {
    webpSrc: buildWebpUrl(filename, preferredWidth),
    fallbackSrc: buildFallbackUrl(filename),
    srcSet: buildSrcSet(filename, responsiveWidths ?? []),
  }
}

export const heroAsset = {
  filename: 'Black Feathers.jpg',
  alt: 'Black Feathers',
  width: 800,
  height: 522,
  sizes: '(min-width: 1280px) 1000px, (min-width: 768px) 88vw, 100vw',
  preferredWidth: 1200,
}

export const decorativeAssets: CoverAsset[] = [
  {
    filename: 'Glass Collection.jpg',
    alt: 'Glass Collection',
    className: 'left-0 top-[2%] w-[180px] lg:w-[220px]',
    delay: '0.1s',
    width: 560,
    height: 362,
    sizes: '(min-width: 1024px) 220px, 180px',
    preferredWidth: 440,
  },
  {
    filename: 'Window Curtain.jpg',
    alt: 'Window Curtain',
    className: 'left-[5%] top-[30%] w-[90px] lg:w-[110px]',
    delay: '0.2s',
    width: 340,
    height: 498,
    sizes: '(min-width: 1024px) 110px, 90px',
    preferredWidth: 220,
  },
  {
    filename: 'Pearl Earring.jpg',
    alt: 'Pearl Earring',
    className: 'left-[15%] top-[12%] w-[130px] lg:w-[160px]',
    delay: '0.15s',
    width: 588,
    height: 714,
    sizes: '(min-width: 1024px) 160px, 130px',
    preferredWidth: 320,
  },
  {
    filename: 'Gold Heels.jpg',
    alt: 'Gold Heels',
    className: 'left-[35%] top-[2%] w-[140px] lg:w-[170px]',
    delay: '0.1s',
    width: 1296,
    height: 1783,
    sizes: '(min-width: 1024px) 170px, 140px',
    preferredWidth: 340,
  },
  {
    filename: 'Chair Lean.jpg',
    alt: 'Chair Lean',
    className: 'left-[50%] top-[2%] w-[140px] lg:w-[170px]',
    delay: '0.1s',
    width: 1296,
    height: 1783,
    sizes: '(min-width: 1024px) 170px, 140px',
    preferredWidth: 340,
  },
  {
    filename: 'Glass Apple.jpg',
    alt: 'Glass Apple',
    className: 'right-[20%] top-[2%] w-[120px] lg:w-[150px]',
    delay: '0.15s',
    width: 406,
    height: 494,
    sizes: '(min-width: 1024px) 150px, 120px',
    preferredWidth: 300,
  },
  {
    filename: 'Beach Chairs.jpg',
    alt: 'Beach Chairs',
    className: '-right-[15%] top-[10%] w-[260px] lg:w-[320px]',
    delay: '0.2s',
    width: 1280,
    height: 917,
    sizes: '(min-width: 1024px) 320px, 260px',
    preferredWidth: 640,
  },
  {
    filename: 'Long Cape.jpg',
    alt: 'Long Cape',
    className: 'left-0 bottom-[2%] w-[190px] lg:w-[230px]',
    delay: '0.25s',
    width: 3184,
    height: 4364,
    sizes: '(min-width: 1024px) 230px, 190px',
    preferredWidth: 460,
  },
  {
    filename: 'Puffer Duo.jpg',
    alt: 'Puffer Duo',
    className: 'left-[22%] bottom-[5%] w-[160px] lg:w-[200px]',
    delay: '0.3s',
    width: 1239,
    height: 1682,
    sizes: '(min-width: 1024px) 200px, 160px',
    preferredWidth: 400,
  },
  {
    filename: 'Hug Coat.jpg',
    alt: 'Hug Coat',
    className: 'right-[20%] bottom-[2%] w-[180px] lg:w-[220px]',
    delay: '0.3s',
    width: 1299,
    height: 1624,
    sizes: '(min-width: 1024px) 220px, 180px',
    preferredWidth: 440,
  },
  {
    filename: 'Lace Glasses.jpg',
    alt: 'Lace Glasses',
    className: 'right-[2%] top-[50%] w-[160px] lg:w-[200px]',
    delay: '0.25s',
    width: 661,
    height: 518,
    sizes: '(min-width: 1024px) 200px, 160px',
    preferredWidth: 400,
  },
]
