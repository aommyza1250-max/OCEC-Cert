/** เลขหน้าแบบหน้าละ 100 พร้อมแถบลิงก์ครั้งละ 10 หน้า */
export function adminPageWindow(total: number, rawPage: string | undefined, pageSize = 100, linkCount = 10) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, lastPage) : 1;
  const firstLink = Math.floor((page - 1) / linkCount) * linkCount + 1;
  const pageNumbers = Array.from({ length: Math.min(linkCount, lastPage - firstLink + 1) }, (_, index) => firstLink + index);
  return {
    page,
    lastPage,
    firstLink,
    pageNumbers,
    from: total === 0 ? 0 : (page - 1) * pageSize + 1,
    to: Math.min(page * pageSize, total),
  };
}
