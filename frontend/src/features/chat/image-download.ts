export async function downloadImageAsset(imageUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = imageUrl
  link.download = fileName
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export async function copyImageAssetLink(imageUrl: string) {
  try {
    await navigator.clipboard.writeText(imageUrl)
  } catch {
    // silent fail
  }
}
