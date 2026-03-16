export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface SolarPanel {
  center: LatLng;
  orientation: "PORTRAIT" | "LANDSCAPE";
  yearlyEnergyDcKwh: number;
  segmentIndex: number;
}

export interface RoofSegmentStat {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: {
    areaMeters2: number;
    sunshineQuantiles: number[];
    groundAreaMeters2: number;
  };
  center: LatLng;
  boundingBox: {
    sw: LatLng;
    ne: LatLng;
  };
}

export interface SolarPanelConfig {
  panelsCount: number;
  yearlyEnergyDcKwh: number;
  roofSegmentSummaries: {
    panelsCount: number;
    yearlyEnergyDcKwh: number;
    segmentIndex: number;
    pitchDegrees: number;
    azimuthDegrees: number;
  }[];
}

export interface BuildingInsights {
  name: string;
  center: LatLng;
  imageryDate: { year: number; month: number; day: number };
  postalCode: string;
  administrativeArea: string;
  solarPotential: {
    maxArrayPanelsCount: number;
    maxArrayAreaMeters2: number;
    maxSunshineHoursPerYear: number;
    carbonOffsetFactorKgPerMwh: number;
    panelCapacityWatts: number;
    panelHeightMeters: number;
    panelWidthMeters: number;
    panelLifetimeYears: number;
    roofSegmentStats: RoofSegmentStat[];
    solarPanels: SolarPanel[];
    solarPanelConfigs: SolarPanelConfig[];
  };
}

export interface SolarCompany {
  id: string;
  name: string;
  nameEn: string;
  modelName: string;
  panelWidthM: number;
  panelHeightM: number;
  panelWatts: number;
  color: string;
  bgColor: string;
}
