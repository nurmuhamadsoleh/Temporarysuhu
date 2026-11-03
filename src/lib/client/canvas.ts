/** Encode locally: fetching a data URL is forbidden by our connect-src CSP. */
export function signatureBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else
        reject(
          new Error("Tanda tangan belum dapat diproses. Silakan coba kembali."),
        );
    }, "image/png");
  });
}
