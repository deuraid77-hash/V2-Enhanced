using System;

namespace LivingLosSantos.Audio
{
    // Pure companion audio policy; no GTA SDK, device or native calls.
    public struct Point3
    {
        public double X, Y, Z;
        public Point3(double x, double y, double z) { X = x; Y = y; Z = z; }
    }
    public struct StereoGain
    {
        public double Left, Right, Distance, Pan;
    }
    public static class AudioPolicy
    {
        public static double Clamp(double value, double min, double max)
        {
            if (Double.IsNaN(value) || Double.IsInfinity(value)) return min;
            return Math.Max(min, Math.Min(max, value));
        }
        public static StereoGain Spatial(Point3 listener, Point3 right, Point3 speaker,
            double referenceDistance, double maxDistance, double rolloff, double strength, double gain)
        {
            double x = speaker.X - listener.X, y = speaker.Y - listener.Y, z = speaker.Z - listener.Z;
            double distance = Math.Sqrt(x*x + y*y + z*z);
            double rightLength = Math.Sqrt(right.X*right.X + right.Y*right.Y + right.Z*right.Z);
            double pan = distance < 0.001 || rightLength < 0.001 ? 0 :
                Clamp((x*right.X + y*right.Y + z*right.Z) / (distance*rightLength), -1, 1) * Clamp(strength, 0, 1);
            referenceDistance = Clamp(referenceDistance, 0.1, 100);
            maxDistance = Math.Max(referenceDistance, Clamp(maxDistance, 0.1, 1000));
            double attenuation = distance >= maxDistance ? 0 : Math.Pow(referenceDistance / Math.Max(referenceDistance, distance), Clamp(rolloff, 0.1, 4));
            // Smooth the last quarter of the audible radius to avoid a hard range edge.
            attenuation *= Clamp((maxDistance - distance) / Math.Max(0.1, maxDistance * 0.25), 0, 1);
            double volume = Clamp(gain, 0, 1) * attenuation;
            return new StereoGain { Left = volume * Math.Sqrt((1-pan)*0.5), Right = volume * Math.Sqrt((1+pan)*0.5), Distance = distance, Pan = pan };
        }
        public static bool ScopeIsCurrent(string utteranceRuntime, string utteranceScene, string runtime, string scene,
            long nowMs, long poseAtMs, int maxPoseAgeMs, bool paused, bool alive)
        {
            return !paused && alive && !String.IsNullOrEmpty(runtime) && !String.IsNullOrEmpty(scene)
                && String.Equals(utteranceRuntime, runtime, StringComparison.Ordinal)
                && String.Equals(utteranceScene, scene, StringComparison.Ordinal)
                && nowMs >= poseAtMs && nowMs-poseAtMs <= maxPoseAgeMs;
        }
        public static int Priority(string category)
        {
            switch (category) {
                case "conversation": return 100;
                case "combat": case "hurt": return 75;
                case "vehicle": case "phone": return 50;
                case "narrator": return 40;
                default: return 25;
            }
        }
    }
}
