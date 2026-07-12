export type ToothKind =
  | "incisor"
  | "canine"
  | "premolar"
  | "molar";

export interface ToothDefinition {
  number: number;
  kind: ToothKind;
}