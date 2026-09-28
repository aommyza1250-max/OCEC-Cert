/** Keep server-rendered admin timestamps identical to the first browser render. */
const timeZone = "Asia/Bangkok";

export function formatThaiDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export function formatThaiLongDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("th-TH", {
    dateStyle: "long",
    timeZone,
  });
}
