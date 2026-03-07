import {KanjiEntry} from './kanji';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

export type LearnStackParamList = {
  LevelPicker: undefined;
  KanjiList: {jlptLevel: number};
  KanjiDetail: {kanjiId: string; jlptLevel: number};
  LearnSession: {jlptLevel: number};
};

export type ReviewStackParamList = {
  ReviewHome: undefined;
  ReviewSession: {jlptLevel?: number};
  ReviewSummary: {
    correct: number;
    incorrect: number;
    deferred: number;
    kanjiReviewed: string[];
  };
};

export type MainTabParamList = {
  LearnTab: undefined;
  ReviewTab: undefined;
  ProgressTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};
