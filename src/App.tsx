import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import "./App.css";

import type {
  Player,
  PlayerPosition,
  Team,
  TeamPlayer,
} from "./types/player";

type Theme = "dark" | "light";
type MatchStatus = "pending" | "finished";
type BracketSide = "winners" | "losers" | "grandFinal";

interface TournamentMatch {
  id: string;
  bracketSide: BracketSide;
  roundIndex: number;
  matchIndex: number;
  name: string;
  topTeam?: Team;
  bottomTeam?: Team;
  topScore: number;
  bottomScore: number;
  winnerId?: string;
  loserId?: string;
  status: MatchStatus;
}

interface TournamentState {
  winnersRounds: TournamentMatch[][];
  losersRounds: TournamentMatch[][];
  winnersQueues: Record<number, Team[]>;
  losersQueue: Team[];
  eliminatedTeams: Team[];
  winnersChampion?: Team;
  losersChampion?: Team;
  grandFinal?: TournamentMatch;
  grandFinalLosersBo3Won?: boolean;
  champion?: Team;
}

interface SavedAppState {
  players: Player[];
  theme: Theme;
  tournament: TournamentState | null;
}

type SupabaseStatus =
  | "loading"
  | "online"
  | "saving"
  | "error"
  | "local";

interface TournamentStateRow {
  id: string;
  state: SavedAppState;
  updated_at?: string;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey)
    : null;

const SUPABASE_TOURNAMENT_ID =
  (import.meta.env.VITE_SUPABASE_TOURNAMENT_ID as string | undefined) ?? "main";

const WINS_NEEDED = 2;

const participantOptions = [
  4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
];

const STORAGE_KEY = "ciegaslin-tournament-state-v1";

function loadSavedAppState(): SavedAppState | null {
  try {
    if (typeof window === "undefined") return null;

    const savedState = window.localStorage.getItem(STORAGE_KEY);
    if (!savedState) return null;

    return JSON.parse(savedState) as SavedAppState;
  } catch {
    return null;
  }
}

function saveAppState(state: SavedAppState) {
  try {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Si el navegador bloquea localStorage, la app sigue funcionando,
    // simplemente sin guardado automático.
  }
}

function clearSavedAppState() {
  try {
    if (typeof window === "undefined") return;

    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No hacemos nada: borrar el guardado no debe romper la app.
  }
}

async function loadSavedAppStateFromSupabase(): Promise<SavedAppState | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("tournament_states")
    .select("state")
    .eq("id", SUPABASE_TOURNAMENT_ID)
    .maybeSingle<TournamentStateRow>();

  if (error) {
    throw error;
  }

  return data?.state ?? null;
}

async function saveAppStateToSupabase(state: SavedAppState) {
  if (!supabase) return;

  const { error } = await supabase.from("tournament_states").upsert({
    id: SUPABASE_TOURNAMENT_ID,
    state,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

async function clearSavedAppStateFromSupabase() {
  if (!supabase) return;

  const { error } = await supabase
    .from("tournament_states")
    .delete()
    .eq("id", SUPABASE_TOURNAMENT_ID);

  if (error) {
    throw error;
  }
}

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createPlayer(): Player {
  return {
    id: createId(),
    name: "",
    position: "flex",
  };
}

function createPlayers(count: number, currentPlayers: Player[] = []): Player[] {
  return Array.from({ length: count }, (_, index) => {
    return currentPlayers[index] ?? createPlayer();
  });
}

function randomInt(maxExclusive: number) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % maxExclusive;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index--) {
    const randomIndex = randomInt(index + 1);
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

function validatePlayers(players: Player[]) {
  const errors: string[] = [];
  const teamCount = players.length / 2;

  const emptyNames = players.filter((player) => player.name.trim().length === 0);

  const goalkeepers = players.filter(
    (player) => player.position === "goalkeeper"
  ).length;

  const forwards = players.filter(
    (player) => player.position === "forward"
  ).length;

  const flex = players.filter((player) => player.position === "flex").length;

  if (emptyNames.length > 0) {
    errors.push("Rellena el nombre de todos los jugadores.");
  }

  if (players.length % 2 !== 0) {
    errors.push("El número de jugadores debe ser par.");
  }

  if (goalkeepers > teamCount) {
    errors.push(
      `Hay demasiados porteros. Para ${teamCount} equipos solo puede haber ${teamCount} porteros como máximo.`
    );
  }

  if (forwards > teamCount) {
    errors.push(
      `Hay demasiados delanteros. Para ${teamCount} equipos solo puede haber ${teamCount} delanteros como máximo.`
    );
  }

  if (goalkeepers + flex < teamCount) {
    errors.push(`No hay suficientes jugadores para cubrir ${teamCount} porterías.`);
  }

  if (forwards + flex < teamCount) {
    errors.push(`No hay suficientes jugadores para cubrir ${teamCount} delanteros.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function generateTeams(players: Player[]): Team[] {
  const cleanedPlayers = players.map((player) => ({
    ...player,
    name: player.name.trim(),
  }));

  const teamCount = cleanedPlayers.length / 2;

  const fixedGoalkeepers = shuffle(
    cleanedPlayers
      .filter((player) => player.position === "goalkeeper")
      .map<TeamPlayer>((player) => ({
        ...player,
        assignedRole: "goalkeeper",
        originalPosition: player.position,
      }))
  );

  const fixedForwards = shuffle(
    cleanedPlayers
      .filter((player) => player.position === "forward")
      .map<TeamPlayer>((player) => ({
        ...player,
        assignedRole: "forward",
        originalPosition: player.position,
      }))
  );

  const flexPlayers = shuffle(
    cleanedPlayers.filter((player) => player.position === "flex")
  );

  const flexNeededAsGoalkeeper = teamCount - fixedGoalkeepers.length;

  const flexGoalkeepers = flexPlayers
    .slice(0, flexNeededAsGoalkeeper)
    .map<TeamPlayer>((player) => ({
      ...player,
      assignedRole: "goalkeeper",
      originalPosition: player.position,
    }));

  const flexForwards = flexPlayers
    .slice(flexNeededAsGoalkeeper)
    .map<TeamPlayer>((player) => ({
      ...player,
      assignedRole: "forward",
      originalPosition: player.position,
    }));

  const finalGoalkeepers = shuffle([...fixedGoalkeepers, ...flexGoalkeepers]);
  const finalForwards = shuffle([...fixedForwards, ...flexForwards]);

  return Array.from({ length: teamCount }, (_, index) => {
    const goalkeeper = finalGoalkeepers[index];
    const forward = finalForwards[index];

    return {
      id: createId(),
      name: `${goalkeeper.name} / ${forward.name}`,
      players: [goalkeeper, forward],
    };
  });
}

function createMatch(
  bracketSide: BracketSide,
  roundIndex: number,
  matchIndex: number,
  topTeam: Team,
  bottomTeam: Team,
  name: string
): TournamentMatch {
  return {
    id: createId(),
    bracketSide,
    roundIndex,
    matchIndex,
    name,
    topTeam,
    bottomTeam,
    topScore: 0,
    bottomScore: 0,
    status: "pending",
  };
}

function createInitialTournament(teams: Team[]): TournamentState {
  const shuffledTeams = shuffle(teams);
  const winnersRounds: TournamentMatch[][] = [[]];
  const winnersQueues: Record<number, Team[]> = {};
  const losersRounds: TournamentMatch[][] = [];

  for (let index = 0; index < shuffledTeams.length; index += 2) {
    const topTeam = shuffledTeams[index];
    const bottomTeam = shuffledTeams[index + 1];

    if (topTeam && bottomTeam) {
      winnersRounds[0].push(
        createMatch(
          "winners",
          0,
          winnersRounds[0].length,
          topTeam,
          bottomTeam,
          `Winners ${winnersRounds[0].length + 1}`
        )
      );
    }

    if (topTeam && !bottomTeam) {
      winnersQueues[1] = [topTeam];
    }
  }

  return {
    winnersRounds,
    losersRounds,
    winnersQueues,
    losersQueue: [],
    eliminatedTeams: [],
  };
}

function cloneTournament(tournament: TournamentState): TournamentState {
  return {
    ...tournament,
    winnersRounds: tournament.winnersRounds.map((round) =>
      round.map((match) => ({ ...match }))
    ),
    losersRounds: tournament.losersRounds.map((round) =>
      round.map((match) => ({ ...match }))
    ),
    winnersQueues: Object.fromEntries(
      Object.entries(tournament.winnersQueues).map(([roundIndex, teams]) => [
        roundIndex,
        [...teams],
      ])
    ),
    losersQueue: [...tournament.losersQueue],
    eliminatedTeams: [...tournament.eliminatedTeams],
    grandFinal: tournament.grandFinal
      ? { ...tournament.grandFinal }
      : undefined,
  };
}

function hasUnfinishedMatches(rounds: TournamentMatch[][]) {
  return rounds.some((round) =>
    round.some((match) => match.status !== "finished")
  );
}

function getQueuedWinners(tournament: TournamentState) {
  return Object.values(tournament.winnersQueues).flat();
}

function isRoundFinished(round?: TournamentMatch[]) {
  return !round || round.every((match) => match.status === "finished");
}

function promoteWinnersByes(tournament: TournamentState) {
  let changed = true;

  while (changed) {
    changed = false;

    const hasPendingWinnersMatches = hasUnfinishedMatches(tournament.winnersRounds);
    const queuedWinners = getQueuedWinners(tournament);

    // Si solo queda un equipo en Winners y ya no hay partidos pendientes,
    // ese equipo ya es finalista de Winners. No debe seguir subiendo rondas.
    if (!hasPendingWinnersMatches && queuedWinners.length <= 1) {
      return;
    }

    const queueIndexes = Object.keys(tournament.winnersQueues)
      .map(Number)
      .sort((left, right) => left - right);

    for (const roundIndex of queueIndexes) {
      const queue = tournament.winnersQueues[roundIndex] ?? [];

      if (queue.length !== 1) continue;

      // El equipo suelto de la ronda N solo puede recibir rival desde la ronda N-1.
      // Si la ronda anterior ya terminó y sigue solo, tiene bye y pasa a N+1.
      if (!isRoundFinished(tournament.winnersRounds[roundIndex - 1])) {
        continue;
      }

      const [team] = queue;
      tournament.winnersQueues[roundIndex] = [];
      addToWinnersQueue(tournament, roundIndex + 1, team);

      changed = true;
      break;
    }
  }
}

function getLosersTargetRoundIndex(tournament: TournamentState) {
  const lastRoundIndex = tournament.losersRounds.length - 1;

  if (lastRoundIndex < 0) return 0;

  const lastRoundHasPendingMatches = tournament.losersRounds[lastRoundIndex].some(
    (match) => match.status !== "finished"
  );

  return lastRoundHasPendingMatches ? lastRoundIndex : lastRoundIndex + 1;
}

function addToWinnersQueue(
  tournament: TournamentState,
  roundIndex: number,
  team: Team
) {
  const queue = [...(tournament.winnersQueues[roundIndex] ?? []), team];
  tournament.winnersQueues[roundIndex] = [];

  while (queue.length >= 2) {
    const topTeam = queue.shift();
    const bottomTeam = queue.shift();

    if (!topTeam || !bottomTeam) continue;

    if (!tournament.winnersRounds[roundIndex]) {
      tournament.winnersRounds[roundIndex] = [];
    }

    const matchIndex = tournament.winnersRounds[roundIndex].length;

    tournament.winnersRounds[roundIndex].push(
      createMatch(
        "winners",
        roundIndex,
        matchIndex,
        topTeam,
        bottomTeam,
        `Winners ${roundIndex + 1}.${matchIndex + 1}`
      )
    );
  }

  tournament.winnersQueues[roundIndex] = queue;
}

function addToLosersQueue(tournament: TournamentState, team: Team) {
  const queue = [...tournament.losersQueue, team];
  tournament.losersQueue = [];

  while (queue.length >= 2) {
    const topTeam = queue.shift();
    const bottomTeam = queue.shift();

    if (!topTeam || !bottomTeam) continue;

    const roundIndex = getLosersTargetRoundIndex(tournament);

    if (!tournament.losersRounds[roundIndex]) {
      tournament.losersRounds[roundIndex] = [];
    }

    const matchIndex = tournament.losersRounds[roundIndex].length;

    tournament.losersRounds[roundIndex].push(
      createMatch(
        "losers",
        roundIndex,
        matchIndex,
        topTeam,
        bottomTeam,
        `Losers ${roundIndex + 1}.${matchIndex + 1}`
      )
    );
  }

  tournament.losersQueue = queue;
}

function maybeSetWinnersChampion(tournament: TournamentState) {
  if (tournament.winnersChampion) return;

  const hasPendingWinnersMatches = hasUnfinishedMatches(tournament.winnersRounds);
  const queuedWinners = getQueuedWinners(tournament);

  if (!hasPendingWinnersMatches && queuedWinners.length === 1) {
    tournament.winnersChampion = queuedWinners[0];
    tournament.winnersQueues = {};
  }
}

function maybeSetLosersChampion(tournament: TournamentState) {
  if (!tournament.winnersChampion || tournament.losersChampion) return;

  const hasPendingLosersMatches = hasUnfinishedMatches(tournament.losersRounds);

  if (!hasPendingLosersMatches && tournament.losersQueue.length === 1) {
    tournament.losersChampion = tournament.losersQueue[0];
    tournament.losersQueue = [];
  }
}

function maybeCreateGrandFinal(tournament: TournamentState) {
  if (
    tournament.winnersChampion &&
    tournament.losersChampion &&
    !tournament.grandFinal &&
    !tournament.champion
  ) {
    tournament.grandFinal = createMatch(
      "grandFinal",
      0,
      0,
      tournament.winnersChampion,
      tournament.losersChampion,
      "Gran Final"
    );
  }
}

function normalizeTournament(tournament: TournamentState) {
  promoteWinnersByes(tournament);
  maybeSetWinnersChampion(tournament);
  maybeSetLosersChampion(tournament);
  maybeCreateGrandFinal(tournament);
}

function findMatch(
  tournament: TournamentState,
  matchId: string
): TournamentMatch | undefined {
  for (const round of tournament.winnersRounds) {
    const match = round.find((item) => item.id === matchId);
    if (match) return match;
  }

  for (const round of tournament.losersRounds) {
    const match = round.find((item) => item.id === matchId);
    if (match) return match;
  }

  if (tournament.grandFinal?.id === matchId) return tournament.grandFinal;

  return undefined;
}

function getMatchWinnerAndLoser(match: TournamentMatch) {
  if (!match.topTeam || !match.bottomTeam) return null;

  const topWon = match.topScore >= WINS_NEEDED;

  return {
    winner: topWon ? match.topTeam : match.bottomTeam,
    loser: topWon ? match.bottomTeam : match.topTeam,
  };
}

function completeMatch(tournament: TournamentState, match: TournamentMatch) {
  const result = getMatchWinnerAndLoser(match);
  if (!result) return;

  const { winner, loser } = result;

  match.status = "finished";
  match.winnerId = winner.id;
  match.loserId = loser.id;

  if (match.bracketSide === "winners") {
    addToWinnersQueue(tournament, match.roundIndex + 1, winner);
    addToLosersQueue(tournament, loser);
  }

  if (match.bracketSide === "losers") {
    addToLosersQueue(tournament, winner);

    const alreadyEliminated = tournament.eliminatedTeams.some(
      (team) => team.id === loser.id
    );

    if (!alreadyEliminated) {
      tournament.eliminatedTeams.push(loser);
    }
  }

  if (match.bracketSide === "grandFinal") {
    const winnerComesFromWinners =
      tournament.winnersChampion?.id === winner.id;
    const winnerComesFromLosers =
      tournament.losersChampion?.id === winner.id;

    // Si Losers ya ganó un BO3 antes, este BO3 ya decide el torneo.
    if (tournament.grandFinalLosersBo3Won) {
      tournament.champion = winner;
      normalizeTournament(tournament);
      return;
    }

    // El equipo que llega por Winners solo necesita ganar 1 BO3.
    if (winnerComesFromWinners) {
      tournament.champion = winner;
      normalizeTournament(tournament);
      return;
    }

    // El equipo que llega por Losers necesita ganar primero un BO3 para
    // resetear el bracket. No creamos otro cuadro: marcamos el checkbox
    // y reutilizamos este mismo match para el segundo BO3.
    if (
      winnerComesFromLosers &&
      tournament.winnersChampion &&
      tournament.losersChampion
    ) {
      tournament.grandFinalLosersBo3Won = true;
      match.status = "pending";
      match.winnerId = undefined;
      match.loserId = undefined;
      match.topScore = 0;
      match.bottomScore = 0;

      normalizeTournament(tournament);
      return;
    }
  }

  normalizeTournament(tournament);
}

function undoCompletedMatch(tournament: TournamentState, match: TournamentMatch) {
  if (match.status !== "finished") return;

  const result = getMatchWinnerAndLoser(match);
  if (!result) return;

  const { winner, loser } = result;

  match.status = "pending";
  match.winnerId = undefined;
  match.loserId = undefined;

  if (match.bracketSide === "winners") {
    removeTeamFromWinnersFuture(tournament, winner, match.roundIndex + 1);
    removeTeamFromLosersFuture(tournament, loser);
    tournament.winnersChampion = undefined;
  }

  if (match.bracketSide === "losers") {
    removeTeamFromLosersFuture(tournament, winner);

    tournament.eliminatedTeams = tournament.eliminatedTeams.filter(
      (team) => team.id !== loser.id
    );

    tournament.losersChampion = undefined;
  }

  if (match.bracketSide === "grandFinal") {
    tournament.champion = undefined;
  }
}

function removeTeamFromWinnersFuture(
  tournament: TournamentState,
  team: Team,
  roundIndex: number
) {
  tournament.winnersQueues[roundIndex] =
    tournament.winnersQueues[roundIndex]?.filter(
      (queuedTeam) => queuedTeam.id !== team.id
    ) ?? [];

  const round = tournament.winnersRounds[roundIndex];
  if (!round) return;

  const matchIndex = round.findIndex(
    (match) =>
      match.status === "pending" &&
      (match.topTeam?.id === team.id || match.bottomTeam?.id === team.id)
  );

  if (matchIndex === -1) return;

  const match = round[matchIndex];

  const otherTeam =
    match.topTeam?.id === team.id ? match.bottomTeam : match.topTeam;

  round.splice(matchIndex, 1);

  if (otherTeam) {
    tournament.winnersQueues[roundIndex] = [
      ...(tournament.winnersQueues[roundIndex] ?? []),
      otherTeam,
    ];
  }
}

function removeTeamFromLosersFuture(tournament: TournamentState, team: Team) {
  tournament.losersQueue = tournament.losersQueue.filter(
    (queuedTeam) => queuedTeam.id !== team.id
  );

  for (const round of tournament.losersRounds) {
    const matchIndex = round.findIndex(
      (match) =>
        match.status === "pending" &&
        (match.topTeam?.id === team.id || match.bottomTeam?.id === team.id)
    );

    if (matchIndex === -1) continue;

    const match = round[matchIndex];

    const otherTeam =
      match.topTeam?.id === team.id ? match.bottomTeam : match.topTeam;

    round.splice(matchIndex, 1);

    if (otherTeam) {
      tournament.losersQueue = [...tournament.losersQueue, otherTeam];
    }

    return;
  }
}

export default function App() {
  const [savedAppState] = useState<SavedAppState | null>(() =>
    loadSavedAppState()
  );

  const [players, setPlayers] = useState<Player[]>(() =>
    savedAppState?.players?.length ? savedAppState.players : createPlayers(4)
  );
  const [theme, setTheme] = useState<Theme>(
    () => savedAppState?.theme ?? "light"
  );
  const [tournament, setTournament] = useState<TournamentState | null>(
    () => savedAppState?.tournament ?? null
  );
  const [remoteLoaded, setRemoteLoaded] = useState(() => !supabase);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus>(() =>
    supabase ? "loading" : "local"
  );

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function loadRemoteState() {
      try {
        const remoteState = await loadSavedAppStateFromSupabase();

        if (cancelled) return;

        if (remoteState) {
          setPlayers(
            remoteState.players?.length ? remoteState.players : createPlayers(4)
          );
          setTheme(remoteState.theme ?? "light");
          setTournament(remoteState.tournament ?? null);
          saveAppState(remoteState);
        }

        setRemoteLoaded(true);
        setSupabaseStatus("online");
      } catch (error) {
        console.error("Error cargando Supabase", error);

        if (!cancelled) {
          setRemoteLoaded(true);
          setSupabaseStatus("error");
        }
      }
    }

    void loadRemoteState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const state = {
      players,
      theme,
      tournament,
    };

    saveAppState(state);

    if (!remoteLoaded || !supabase) return;

    const timeoutId = window.setTimeout(() => {
      setSupabaseStatus("saving");

      void saveAppStateToSupabase(state)
        .then(() => {
          setSupabaseStatus("online");
        })
        .catch((error) => {
          console.error("Error guardando Supabase", error);
          setSupabaseStatus("error");
        });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [players, theme, tournament, remoteLoaded]);

  const stats = useMemo(() => {
    return {
      total: players.length,
      teams: players.length / 2,
      goalkeepers: players.filter((player) => player.position === "goalkeeper")
        .length,
      forwards: players.filter((player) => player.position === "forward").length,
      flex: players.filter((player) => player.position === "flex").length,
      completedNames: players.filter((player) => player.name.trim().length > 0)
        .length,
    };
  }, [players]);

  const validation = useMemo(() => validatePlayers(players), [players]);

  const queuedWinners = tournament ? getQueuedWinners(tournament) : [];

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "light" ? "dark" : "light"));
  }

  function handleParticipantChange(count: number) {
    setPlayers((currentPlayers) => createPlayers(count, currentPlayers));
    setTournament(null);
  }
  function updatePlayer<T extends keyof Player>(
    id: string,
    field: T,
    value: Player[T]
  ) {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === id ? { ...player, [field]: value } : player
      )
    );

    setTournament(null);
  }

  function handleDraw() {
    if (!validation.isValid || tournament) return;

    const generatedTeams = generateTeams(players);
    const initialTournament = createInitialTournament(generatedTeams);

    normalizeTournament(initialTournament);

    setTournament(initialTournament);
  }

  function handleAddPoint(matchId: string, teamId: string) {
    setTournament((currentTournament) => {
      if (!currentTournament) return currentTournament;
      if (currentTournament.champion) return currentTournament;

      const nextTournament = cloneTournament(currentTournament);
      const match = findMatch(nextTournament, matchId);

      if (!match || match.status === "finished") return currentTournament;

      if (match.topTeam?.id === teamId) {
        match.topScore = Math.min(WINS_NEEDED, match.topScore + 1);
      }

      if (match.bottomTeam?.id === teamId) {
        match.bottomScore = Math.min(WINS_NEEDED, match.bottomScore + 1);
      }

      if (match.topScore >= WINS_NEEDED || match.bottomScore >= WINS_NEEDED) {
        completeMatch(nextTournament, match);
      }

      return nextTournament;
    });
  }

  function resetPlayers() {
    clearSavedAppState();
    clearSavedAppStateFromSupabase().catch((error) => {
      console.error("Error borrando Supabase", error);
      setSupabaseStatus("error");
    });
    setPlayers(createPlayers(4));
    setTournament(null);
  }

    function renderTeamRow(
      match: TournamentMatch,
      team: Team | undefined,
      score: number
    ) {
      const isWinner = team && match.winnerId === team.id;
      const isLoser = team && match.loserId === team.id;

      const canAdd =
        Boolean(team) &&
        match.status !== "finished" &&
        !tournament?.champion &&
        score < WINS_NEEDED;

      const canSubtract = Boolean(team) && score > 0;

      return (
        <div
          className={`match-team-row ${isWinner ? "match-winner" : ""} ${
            isLoser ? "match-loser" : ""
          }`}
        >
          <div>
            <strong>{team?.name ?? "Pendiente"}</strong>
            {isWinner && <span>Ganador</span>}
            {isLoser && <span>Perdedor</span>}
          </div>

          <div className="score-controls">
            <button
              className="score-btn score-minus"
              disabled={!canSubtract}
              onClick={() => team && handleSubtractPoint(match.id, team.id)}
            >
              -
            </button>

            <span className="score-pill">{score}</span>

            <button
              className="score-btn"
              disabled={!canAdd}
              onClick={() => team && handleAddPoint(match.id, team.id)}
            >
              +
            </button>
          </div>
        </div>
      );
    }

    function renderMatch(match: TournamentMatch) {
    return (
      <article
        className={`tournament-match ${
          match.status === "finished" ? "match-finished" : ""
        }`}
        key={match.id}
      >
        <div className="match-header">
          <span>{match.name}</span>
          <strong>BO3</strong>
        </div>

        {renderTeamRow(match, match.topTeam, match.topScore)}
        {renderTeamRow(match, match.bottomTeam, match.bottomScore)}
      </article>
    );
  }

    function handleSubtractPoint(matchId: string, teamId: string) {
      setTournament((currentTournament) => {
        if (!currentTournament) return currentTournament;

        const nextTournament = cloneTournament(currentTournament);
        const match = findMatch(nextTournament, matchId);

        if (!match) return currentTournament;

        if (match.status === "finished") {
          undoCompletedMatch(nextTournament, match);
        }

        if (match.topTeam?.id === teamId) {
          match.topScore = Math.max(0, match.topScore - 1);
        }

        if (match.bottomTeam?.id === teamId) {
          match.bottomScore = Math.max(0, match.bottomScore - 1);
        }

        nextTournament.champion = undefined;

        return nextTournament;
      });
    }

    function renderWorldBracket(
    title: string,
    description: string,
    rounds: TournamentMatch[][],
    champion: Team | undefined,
    emptyMessage: string
  ) {
    const playableRounds = rounds.filter((round) => round.length > 0);

    if (playableRounds.length === 0) {
      return (
        <section className="world-bracket-section">
          <div className="bracket-title">
            <h3>{title}</h3>
            <p>{description}</p>
          </div>

          <div className="waiting-box">
            <strong>{emptyMessage}</strong>
          </div>
        </section>
      );
    }

    const onlyOneMatch =
      playableRounds.length === 1 && playableRounds[0].length === 1;

    const hasFinalRound =
      onlyOneMatch ||
      (playableRounds.length > 1 &&
        playableRounds[playableRounds.length - 1].length === 1);

    const centerMatch = hasFinalRound
      ? playableRounds[playableRounds.length - 1][0]
      : undefined;

    const roundsBeforeFinal = hasFinalRound
      ? playableRounds.slice(0, -1)
      : playableRounds;

    const leftRounds = roundsBeforeFinal.map((round) =>
      round.slice(0, Math.ceil(round.length / 2))
    );

    const rightRounds = roundsBeforeFinal
      .map((round) => round.slice(Math.ceil(round.length / 2)))
      .reverse();

    return (
      <section className="world-bracket-section">
        <div className="bracket-title">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

        <div className="world-bracket-scroll">
          <div className="world-bracket">
            <div className="world-side world-side-left">
              {leftRounds.map((round, roundIndex) => (
                <div className="world-round" key={`${title}-left-${roundIndex}`}>
                  <h4>Ronda {roundIndex + 1}</h4>

                  <div className={`world-round-matches spacing-${roundIndex}`}>
                    {round.map(renderMatch)}
                  </div>
                </div>
              ))}
            </div>

            <div className="world-center">
              <h4>{champion ? "Campeón" : "Final"}</h4>

              {champion ? (
                <div className="world-champion">
                  <span>Clasificado</span>
                  <strong>{champion.name}</strong>
                </div>
              ) : centerMatch ? (
                renderMatch(centerMatch)
              ) : (
                <div className="waiting-box">
                  <strong>Final pendiente</strong>
                  <span>Se generará cuando avancen los equipos.</span>
                </div>
              )}
            </div>

            <div className="world-side world-side-right">
              {rightRounds.map((round, roundIndex) => (
                <div className="world-round" key={`${title}-right-${roundIndex}`}>
                  <h4>Ronda {rightRounds.length - roundIndex}</h4>

                  <div
                    className={`world-round-matches spacing-${
                      rightRounds.length - roundIndex - 1
                    }`}
                  >
                    {round.map(renderMatch)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <main className="app" data-theme={theme}>
      <section className="hero">
        <div className="top-bar">
          <span className="eyebrow">Ciegas Lin</span>
          <span className={`autosave-pill status-${supabaseStatus}`}>
            {supabaseStatus === "loading" && "Cargando Supabase"}
            {supabaseStatus === "saving" && "Guardando en Supabase"}
            {supabaseStatus === "online" && "Guardado en Supabase"}
            {supabaseStatus === "error" && "Error Supabase · local activo"}
            {supabaseStatus === "local" && "Guardado local"}
          </span>

          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? "Modo oscuro" : "Modo claro"}
          </button>
        </div>

        <div className="hero-card">
          <span>Participantes</span>
          <strong>{stats.total}</strong>
          <small>{stats.teams} equipos posibles</small>
        </div>
      </section>

      <section className="layout">
        <section className="panel main-panel">
          <div className="panel-header">
            <div>
              <h2>Jugadores</h2>
              <p>Introduce nombre y posición preferida.</p>
            </div>

            <label className="select-box">
              <span>Total</span>
              <select
                value={players.length}
                onChange={(event) =>
                  handleParticipantChange(Number(event.target.value))
                }
              >
                {participantOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} jugadores
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="players-list">
            {players.map((player, index) => (
              <article className="player-row" key={player.id}>
                <div className="player-number">{index + 1}</div>

                <label className="field name-field">
                  <span>Nombre</span>
                  <input
                    type="text"
                    placeholder={`Jugador ${index + 1}`}
                    value={player.name}
                    onChange={(event) =>
                      updatePlayer(player.id, "name", event.target.value)
                    }
                  />
                </label>

                <label className="field position-field">
                  <span>Posición</span>
                  <select
                    value={player.position}
                    onChange={(event) =>
                      updatePlayer(
                        player.id,
                        "position",
                        event.target.value as PlayerPosition
                      )
                    }
                  >
                    <option value="goalkeeper">Portero</option>
                    <option value="forward">Delantero</option>
                    <option value="flex">Indiferente</option>
                  </select>
                </label>
              </article>
            ))}
          </div>
        </section>

        <section className="panel actions-panel">
          {validation.isValid ? (
            <div className="status-box">
              <div className="status-dot" />
              <div>
                <strong>Configuración válida</strong>
                <p>Ya puedes sortear los equipos.</p>
              </div>
            </div>
          ) : (
            <div className="status-box warning">
              <div className="status-dot" />
              <div>
                <strong>Falta ajustar datos</strong>
                {validation.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            </div>
          )}

          <div className="actions">
            <button
              className="primary-btn"
              onClick={handleDraw}
              disabled={!validation.isValid || Boolean(tournament)}
              title={
                tournament
                  ? "El sorteo ya está hecho. Pulsa Reiniciar para empezar otro."
                  : undefined
              }
            >
              {tournament ? "Equipos ya sorteados" : "Sortear equipos"}
            </button>
            <button className="secondary-btn" onClick={resetPlayers}>
              Reiniciar
            </button>
          </div>
        </section>

        <section className="panel result-panel">
          <div className="panel-header compact">
            <div>
              <h2>Resultado</h2>
              <p>Doble eliminación: Winners, Losers y Gran Final.</p>
            </div>
          </div>
          
          {tournament ? (
            <div className="tournament-layout">
              {tournament.champion && (
                <div className="champion-card">
                  <span>Campeón del torneo</span>
                  <strong>{tournament.champion.name}</strong>
                </div>
              )}

              {renderWorldBracket(
                "Cuadro Winners",
                "Todos empiezan aquí. Si pierdes, bajas al cuadro Losers.",
                tournament.winnersRounds,
                tournament.winnersChampion,
                "Aún no hay partidos en Winners."
              )}

              {queuedWinners.length > 0 && !tournament.winnersChampion && (
                <div className="waiting-box">
                  <strong>Esperando rival en Winners</strong>
                  {queuedWinners.map((team) => (
                    <span key={team.id}>{team.name}</span>
                  ))}
                </div>
              )}

              {renderWorldBracket(
                "Cuadro Losers",
                "Si pierdes aquí, quedas eliminado.",
                tournament.losersRounds,
                tournament.losersChampion,
                "Aquí caerán los equipos que pierdan en Winners."
              )}

              {tournament.losersQueue.length > 0 && !tournament.losersChampion && (
                <div className="waiting-box">
                  <strong>Esperando rival en Losers</strong>
                  {tournament.losersQueue.map((team) => (
                    <span key={team.id}>{team.name}</span>
                  ))}
                </div>
              )}

              <section className="world-bracket-section">
                <div className="bracket-title">
                  <h3>Gran Final</h3>
                  <p>
                    El campeón de Winners solo necesita ganar un BO3. El campeón de
                    Losers necesita ganar dos BO3 seguidos.
                  </p>
                </div>

                {tournament.grandFinal && (
                  <label className="grand-final-reset-check">
                    <input
                      type="checkbox"
                      checked={Boolean(tournament.grandFinalLosersBo3Won)}
                      readOnly
                    />
                    <span>
                      Losers ya ganó 1 BO3
                      {tournament.grandFinalLosersBo3Won
                        ? " — ahora este BO3 decide el torneo"
                        : " — todavía necesita ganar 2 BO3"}
                    </span>
                  </label>
                )}

                <div className="grand-final-grid">
                  {tournament.grandFinal ? (
                    renderMatch(tournament.grandFinal)
                  ) : (
                    <div className="waiting-box">
                      <strong>Gran Final pendiente</strong>
                      <span>Esperando campeón de Winners y campeón de Losers.</span>
                    </div>
                  )}
                </div>
              </section>

              {tournament.eliminatedTeams.length > 0 && (
                <section className="eliminated-section">
                  <h3>Eliminados</h3>

                  <div className="eliminated-list">
                    {tournament.eliminatedTeams.map((team) => (
                      <span key={team.id}>{team.name}</span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="result-placeholder">
              <span>🎲</span>
              <strong>Aún no hay sorteo</strong>
              <p>Rellena los jugadores y pulsa “Sortear equipos”.</p>
            </div>
          )}
        </section>

        <section className="panel summary-panel">
          <div className="panel-header compact">
            <div>
              <h2>Resumen</h2>
              <p>Estado actual del sorteo.</p>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span>Equipos</span>
              <strong>{stats.teams}</strong>
            </div>

            <div className="stat-card">
              <span>Nombres</span>
              <strong>
                {stats.completedNames}/{stats.total}
              </strong>
            </div>

            <div className="stat-card">
              <span>Porteros</span>
              <strong>{stats.goalkeepers}</strong>
            </div>

            <div className="stat-card">
              <span>Delanteros</span>
              <strong>{stats.forwards}</strong>
            </div>

            <div className="stat-card full">
              <span>Indiferentes</span>
              <strong>{stats.flex}</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}