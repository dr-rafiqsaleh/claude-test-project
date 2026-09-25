import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

import { isNativeApp } from '@/lib/platform'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    // "data:application/pdf;base64,XXXX" - Filesystem wants only the XXXX.
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

/**
 * Hand a file to the person: a download in a browser, the share sheet in the app.
 *
 * A phone's web view ignores `<a download>`, so in the app the file is written
 * to the app's cache and offered through the system share sheet, from which it
 * can be saved to Files, opened in a PDF viewer, or sent by email or WhatsApp.
 */
export async function saveBlob(blob, filename) {
  if (isNativeApp) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    })
    await Share.share({ title: filename, files: [uri] })
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
