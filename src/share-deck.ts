import { Capacitor } from '@capacitor/core';

export async function shareDeckFile(file: File, title: string) {
  if (Capacitor.getPlatform() === 'android') {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const result = await Filesystem.writeFile({ path: `exports/${file.name}`, directory: Directory.Cache, data, recursive: true });
    await Share.share({ title, files: [result.uri], dialogTitle: 'Export deck' });
  } else if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
  } else {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
