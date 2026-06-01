// Agent preferences — how the media agent behaves, persisted to localStorage.
//   - mode: "manual" (confirm before each generation) | "auto" (run autonomously)
//   - imageModel / videoModel: the default models the agent uses for image /
//     video steps (chosen in Settings). The planner may suggest a model, but the
//     agent always builds steps with these so the choice is predictable.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IMAGE_MODELS, VIDEO_MODELS } from './nodes';

export type AgentMode = 'manual' | 'auto';

interface AgentPrefsState {
  mode: AgentMode;
  imageModel: string;
  videoModel: string;
  setMode: (mode: AgentMode) => void;
  setImageModel: (id: string) => void;
  setVideoModel: (id: string) => void;
}

export const useAgentPrefs = create<AgentPrefsState>()(
  persist(
    (set) => ({
      mode: 'manual',
      imageModel: IMAGE_MODELS[0].id,
      videoModel: VIDEO_MODELS[1].id, // Seedance 1.5 Pro — solid mid default
      setMode: (mode) => set({ mode }),
      setImageModel: (imageModel) => set({ imageModel }),
      setVideoModel: (videoModel) => set({ videoModel }),
    }),
    { name: 'franklin-canvas:agent-prefs' },
  ),
);
