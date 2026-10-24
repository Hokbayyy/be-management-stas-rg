function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftToJakarta(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + 7 * 60 * 60 * 1000);
}

function getJakartaDateIso(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getJakartaWeekBounds(date = new Date()) {
  const jakartaDate = shiftToJakarta(date);
  const dayIndex = jakartaDate.getUTCDay();
  const daysSinceMonday = (dayIndex + 6) % 7;
  const monday = new Date(jakartaDate.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);

  return {
    startDate: formatIsoDate(monday),
    endDate: formatIsoDate(sunday)
  };
}

function getJakartaMonthBounds(date = new Date()) {
  const jakartaDate = shiftToJakarta(date);
  const year = jakartaDate.getUTCFullYear();
  const month = jakartaDate.getUTCMonth();
  const startOfMonth = new Date(Date.UTC(year, month, 1));
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0));

  return {
    startDate: formatIsoDate(startOfMonth),
    endDate: formatIsoDate(endOfMonth)
  };
}

function getPreviousJakartaWeekBounds(date = new Date()) {
  const previousWeekAnchor = new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);
  return getJakartaWeekBounds(previousWeekAnchor);
}

module.exports = {
  getJakartaDateIso,
  getJakartaWeekBounds,
  getJakartaMonthBounds,
  getPreviousJakartaWeekBounds,
  shiftToJakarta
};
