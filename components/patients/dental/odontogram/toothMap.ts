import { ToothKind } from "./types";

export interface ToothDefinition {
  number: number;
  kind: ToothKind;
}

export const upperTeeth: ToothDefinition[] = [
  { number:18, kind:"molar" },
  { number:17, kind:"molar" },
  { number:16, kind:"molar" },
  { number:15, kind:"premolar" },
  { number:14, kind:"premolar" },
  { number:13, kind:"canine" },
  { number:12, kind:"incisor" },
  { number:11, kind:"incisor" },

  { number:21, kind:"incisor" },
  { number:22, kind:"incisor" },
  { number:23, kind:"canine" },
  { number:24, kind:"premolar" },
  { number:25, kind:"premolar" },
  { number:26, kind:"molar" },
  { number:27, kind:"molar" },
  { number:28, kind:"molar" },
];

export const lowerTeeth: ToothDefinition[] = [
  { number:48, kind:"molar" },
  { number:47, kind:"molar" },
  { number:46, kind:"molar" },
  { number:45, kind:"premolar" },
  { number:44, kind:"premolar" },
  { number:43, kind:"canine" },
  { number:42, kind:"incisor" },
  { number:41, kind:"incisor" },

  { number:31, kind:"incisor" },
  { number:32, kind:"incisor" },
  { number:33, kind:"canine" },
  { number:34, kind:"premolar" },
  { number:35, kind:"premolar" },
  { number:36, kind:"molar" },
  { number:37, kind:"molar" },
  { number:38, kind:"molar" },
];