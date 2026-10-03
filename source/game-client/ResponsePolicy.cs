using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace LivingLosSantosV2
{
    // Pure validation shared by the game client and the offline fixtures.
    public static class ResponsePolicy
    {
        public static string CleanText(object value, int limit)
        {
            string raw = Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
            var text = new StringBuilder();
            foreach (char character in raw)
            {
                if (character == '~' || Char.IsControl(character)) continue;
                if (text.Length >= limit) break;
                text.Append(character);
            }
            return text.ToString().Trim();
        }

        public static string Action(object value)
        {
            return CleanText(value, 40).ToUpperInvariant();
        }

        public static bool CanApply(int expectedHandle, int actualHandle, int expectedModel,
            int actualModel, bool exists, bool alive, bool human, bool inVehicle,
            bool persistent, float distance)
        {
            return expectedHandle == actualHandle && expectedModel == actualModel && exists && alive
                && human && !inVehicle && !persistent && !Single.IsNaN(distance)
                && !Single.IsInfinity(distance) && distance >= 0.0f && distance <= 12.0f;
        }

        public static bool IsSupportedAction(string action)
        {
            return action == "TALK_CASUAL" || action == "INTIMIDATE"
                || action == "SURRENDER" || action == "FLEE_PANICKED" || action == "TAKE_COVER"
                || action == "DRAW_WEAPON" || action == "ATTACK_MELEE";
        }

        public static string SourceLabel(Dictionary<string, object> response)
        {
            object source;
            string value = response != null && response.TryGetValue("source", out source) ? CleanText(source, 80) : "";
            return value.StartsWith("gemini-", StringComparison.OrdinalIgnoreCase) ? "Gemini" : "local fallback";
        }

        public static Dictionary<string, object> ParseResult(Dictionary<string, object> response)
        {
            object successful;
            object result;
            if (response == null || !response.TryGetValue("success", out successful) || !(successful is bool)
                || !(bool)successful || !response.TryGetValue("result", out result)
                || !(result is Dictionary<string, object>))
                throw new InvalidOperationException("The dashboard returned an invalid dialogue result.");
            var dictionary = (Dictionary<string, object>)result;
            object speech;
            if (!dictionary.TryGetValue("speech", out speech) || !(speech is string) || String.IsNullOrWhiteSpace(CleanText(speech, 420)))
                throw new InvalidOperationException("The dashboard returned no NPC speech.");
            return dictionary;
        }
    }
}
