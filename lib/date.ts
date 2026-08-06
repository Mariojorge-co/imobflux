export function formatRelativeTime(dateString: string, prefix?: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInSeconds = diffInMs / 1000;
  const diffInDays = Math.floor(diffInSeconds / 86400);

  if (prefix) {
    if (diffInDays <= 0) {
      return `${prefix} hoje`;
    }
    const alwaysFormatter = new Intl.RelativeTimeFormat("pt-BR", {
      numeric: "always",
    });
    if (diffInDays < 30) {
      return `${prefix} ${alwaysFormatter.format(-diffInDays, "day")}`;
    }
    const diffInMonths = Math.floor(diffInDays / 30.436875);
    if (diffInMonths < 12) {
      return `${prefix} ${alwaysFormatter.format(-diffInMonths, "month")}`;
    }
    const diffInYears = Math.floor(diffInDays / 365.25);
    return `${prefix} ${alwaysFormatter.format(-diffInYears, "year")}`;
  }

  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const absDiff = Math.abs(diffInSeconds);

  if (absDiff < 60) {
    return "agora mesmo";
  }

  const diffInMinutes = -diffInSeconds / 60;
  if (absDiff < 3600) {
    return formatter.format(Math.round(diffInMinutes), "minute");
  }

  const diffInHours = diffInMinutes / 60;
  if (absDiff < 86400) {
    return formatter.format(Math.round(diffInHours), "hour");
  }

  const diffInDaysFloat = diffInHours / 24;
  if (absDiff < 2592000) {
    return formatter.format(Math.round(diffInDaysFloat), "day");
  }

  const diffInMonthsFloat = diffInDaysFloat / 30.436875;
  if (absDiff < 31536000) {
    return formatter.format(Math.round(diffInMonthsFloat), "month");
  }

  const diffInYearsFloat = diffInDaysFloat / 365.25;
  return formatter.format(Math.round(diffInYearsFloat), "year");
}
