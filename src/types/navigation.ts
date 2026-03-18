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
  VocabLearnSession: {jlptLevel: number};
};

export type ReviewStackParamList = {
  ReviewHome: undefined;
  ReviewSession: {jlptLevel?: number; practiceMode?: boolean};
  ReviewSummary: {
    correct: number;
    incorrect: number;
    deferred: number;
    kanjiReviewed: string[];
    kanjiWrong: string[];
  };
};

export type SearchStackParamList = {
  Search: undefined;
  SearchDetail: {kanjiId: string};
};

export type MainTabParamList = {
  LearnTab: undefined;
  ReviewTab: undefined;
  SearchTab: undefined;
  ProgressTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};
