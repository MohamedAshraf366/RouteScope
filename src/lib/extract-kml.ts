import { unzipSync, strFromU8 } from "fflate";

export async function extractKmlText(file: File): Promise<string> {
  if (/\.kmz$/i.test(file.name)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buf, {
      filter: (f) => /\.kml$/i.test(f.name),
    });
    const entry =
      files["doc.kml"] ?? Object.values(files)[0];
    if (!entry) throw new Error("No .kml file found inside .kmz archive");
    return strFromU8(entry);
  }
  return file.text();
}
