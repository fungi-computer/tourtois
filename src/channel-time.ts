const dayStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const monthDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const monthDayYear = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * When a channel conversation last moved, for the owner: `Today, 7:30 PM`,
 * `Yesterday, 10:05 AM`, `Nov 9, 10:05 AM`, and with the year only when it is
 * not this one. No seconds; the time of day follows the owner's locale.
 */
export function channelWhen(epochMillis: number, now: number): string {
  const at = new Date(epochMillis);
  const today = new Date(now);
  const days = Math.round((dayStart(today) - dayStart(at)) / 86_400_000);
  const time = clock.format(at);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const date =
    at.getFullYear() === today.getFullYear()
      ? monthDay.format(at)
      : monthDayYear.format(at);
  return `${date}, ${time}`;
}
