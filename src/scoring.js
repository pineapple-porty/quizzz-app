const MAX_MULTIPLIER = 10;

function multiplierForStreak(streak) {
  if (!Number.isInteger(streak) || streak < 2) return 1;

  let multiplier = 1.5;
  for (let win = 3; win <= streak && multiplier < MAX_MULTIPLIER; win += 1) {
    if (win >= 100) {
      if (win % 5 === 0) multiplier += 0.5;
    } else if (win <= 9) {
      multiplier += 0.1;
    } else {
      multiplier += 0.2 + 0.1 * Math.floor((win - 10) / 10);
    }
    multiplier = Math.min(MAX_MULTIPLIER, Number(multiplier.toFixed(1)));
  }
  return multiplier;
}

function levelForPoints(points) {
  return Math.min(100, Math.floor(Math.sqrt(Math.max(0, points) / 50)) + 1);
}

function pointsForWin({ basePoints, difficulty, multiplier, alreadyBeaten }) {
  if (alreadyBeaten) return 0;
  const difficultyFactor = difficulty === "noobie" || difficulty === "easy" ? 0.5 : 1;
  return Math.floor(basePoints * multiplier * difficultyFactor);
}

module.exports = { levelForPoints, multiplierForStreak, pointsForWin };
