
export const getRemainingDaysInfo = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const currentDay = now.getDate();

  let weekdays = 0;
  let weekends = 0;

  for (let d = currentDay; d <= lastDay; d++) {
    const date = new Date(year, month, d);
    const dayOfWeek = date.getDay(); // 0 = Neděle, 6 = Sobota
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekends++;
    } else {
      weekdays++;
    }
  }

  const isTodayWeekend = now.getDay() === 0 || now.getDay() === 6;

  return {
    total: (lastDay - currentDay) + 1,
    weekdays,
    weekends,
    isTodayWeekend
  };
};

export const getDaysRemainingInMonth = (): number => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const currentDay = now.getDate();
  const remaining = (lastDay - currentDay) + 1;
  return remaining > 0 ? remaining : 1;
};

export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
};
