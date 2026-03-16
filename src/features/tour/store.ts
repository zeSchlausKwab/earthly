import { create } from "zustand";

const TOUR_SEEN_KEY = "earthly-tour-seen";

interface TourState {
  isActive: boolean;
  hasSeenTour: boolean;
  startTour: () => void;
  endTour: () => void;
  markAsSeen: () => void;
  resetTour: () => void;
}

export const useTourStore = create<TourState>((set) => ({
  isActive: false,
  hasSeenTour:
    typeof localStorage !== "undefined" &&
    localStorage.getItem(TOUR_SEEN_KEY) === "true",
  startTour: () => set({ isActive: true }),
  endTour: () => set({ isActive: false }),
  markAsSeen: () => {
    localStorage.setItem(TOUR_SEEN_KEY, "true");
    set({ hasSeenTour: true });
  },
  resetTour: () => {
    localStorage.removeItem(TOUR_SEEN_KEY);
    set({ hasSeenTour: false });
  },
}));
