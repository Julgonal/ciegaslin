export type PlayerPosition = "goalkeeper" | "forward" | "flex";
export type AssignedRole = "goalkeeper" | "forward";

export interface Player {
  id: string;
  name: string;
  position: PlayerPosition;
}

export interface TeamPlayer extends Player {
  assignedRole: AssignedRole;
  originalPosition: PlayerPosition;
}

export interface Team {
  id: string;
  name: string;
  players: TeamPlayer[];
}