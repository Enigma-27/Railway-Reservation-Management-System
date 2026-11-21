import { ClassType } from '../constants/enums';

export interface FareRule {
  fareId: number;
  classId?: number;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  ratePerKm?: number;
  classType?: ClassType;
  baseRatePerKm?: number;
  reservationCharge?: number;
  tatkalCharge?: number;
  gstPercentage?: number;
  insurancePremium?: number;
}


/** Answer of GET /api/admin/fares/calculate: the real fare for one passenger (fn_calculate_fare, insurance included). */
export interface RealFareCalculation {
  classCode: string; distanceKm: number; trainType: string; quota: string; concession: string;
  baseFare: number; concessionDiscount: number; reservationCharge: number; superfastCharge: number;
  tatkalCharge: number; dynamicSurcharge: number; gst: number; insurance: number; totalFare: number;
}
