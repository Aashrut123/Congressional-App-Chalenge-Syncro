const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clock(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  const face = hour % 12 || 12;
  return `${face}:${String(rest).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatAvailabilityWindow(weekday: number, startMinute: number, endMinute: number): string {
  return `${days[weekday] ?? 'Day'} ${clock(startMinute)}–${clock(endMinute)}`;
}
