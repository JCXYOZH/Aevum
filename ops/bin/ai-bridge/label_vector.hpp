#pragma once

// 角色动作标签向量：33 维，模型文本 -> 固定标签，不生成关节角度。
//
// 0-12   身体部位
// 13-20  动作
// 21-26  目标
// 27-29  幅度
// 30-32  速度

#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace aevum {

enum LabelIndex : int {
    kRoot = 0,
    kSpine = 1,
    kNeck = 2,
    kHead = 3,
    kEyes = 4,
    kLeftArm = 5,
    kRightArm = 6,
    kLeftHand = 7,
    kRightHand = 8,
    kLeftLeg = 9,
    kRightLeg = 10,
    kLeftFoot = 11,
    kRightFoot = 12,

    kReach = 13,
    kWave = 14,
    kLook = 15,
    kStep = 16,
    kTurn = 17,
    kLean = 18,
    kGrip = 19,
    kRelease = 20,

    kCamera = 21,
    kFront = 22,
    kUp = 23,
    kDown = 24,
    kLeft = 25,
    kRight = 26,

    kSmall = 27,
    kMedium = 28,
    kLarge = 29,

    kSlow = 30,
    kNormal = 31,
    kFast = 32,

    kLabelCount = 33
};

inline const char* LabelName(int index) {
    static const char* names[kLabelCount] = {
        "root", "spine", "neck", "head", "eyes",
        "left_arm", "right_arm", "left_hand", "right_hand",
        "left_leg", "right_leg", "left_foot", "right_foot",
        "reach", "wave", "look", "step", "turn", "lean", "grip", "release",
        "camera", "front", "up", "down", "left", "right",
        "small", "medium", "large",
        "slow", "normal", "fast"
    };
    return index >= 0 && index < kLabelCount ? names[index] : "";
}

class LabelVector {
public:
    LabelVector() { values_.fill(0.0f); }

    void Set(LabelIndex index, float value) {
        if (index < 0 || index >= kLabelCount) return;
        values_[index] = Clamp(value);
    }

    void Add(LabelIndex index, float value) {
        if (index < 0 || index >= kLabelCount) return;
        values_[index] = Clamp(values_[index] + value);
    }

    float Get(LabelIndex index) const {
        if (index < 0 || index >= kLabelCount) return 0.0f;
        return values_[index];
    }

    // 规则编码：中英文关键词直接映射到标签，不依赖模型输出数字。
    void EncodeText(const std::string& text) {
        const std::string lower = ToLowerAscii(text);

        // 先匹配更长的身体部位词，避免“右手臂”被“右手”抢走。
        if (Has(text, lower, "右手臂") || Has(text, lower, "右臂") || Has(text, lower, "right arm") ||
            Has(text, lower, "right_arm")) {
            Set(kRightArm, 1.0f);
        } else if (Has(text, lower, "右手") || Has(text, lower, "right hand") ||
                   Has(text, lower, "right_hand")) {
            Set(kRightHand, 1.0f);
        }
        if (Has(text, lower, "左手臂") || Has(text, lower, "左臂") || Has(text, lower, "left arm") ||
            Has(text, lower, "left_arm")) {
            Set(kLeftArm, 1.0f);
        } else if (Has(text, lower, "左手") || Has(text, lower, "left hand") ||
                   Has(text, lower, "left_hand")) {
            Set(kLeftHand, 1.0f);
        }

        if (Has(text, lower, "右腿") || Has(text, lower, "right leg") || Has(text, lower, "right_leg")) {
            Set(kRightLeg, 1.0f);
        } else if (Has(text, lower, "左腿") || Has(text, lower, "left leg") || Has(text, lower, "left_leg")) {
            Set(kLeftLeg, 1.0f);
        } else if (Has(text, lower, "双腿") || Has(text, lower, "腿") || Has(text, lower, "leg")) {
            Set(kLeftLeg, 0.6f);
            Set(kRightLeg, 0.6f);
        }

        if (Has(text, lower, "右脚") || Has(text, lower, "right foot") || Has(text, lower, "right_foot")) {
            Set(kRightFoot, 1.0f);
        } else if (Has(text, lower, "左脚") || Has(text, lower, "left foot") || Has(text, lower, "left_foot")) {
            Set(kLeftFoot, 1.0f);
        } else if (Has(text, lower, "双脚") || Has(text, lower, "脚") || Has(text, lower, "foot")) {
            Set(kLeftFoot, 0.6f);
            Set(kRightFoot, 0.6f);
        }

        if (Has(text, lower, "头") || Has(text, lower, "head")) Set(kHead, 1.0f);
        if (Has(text, lower, "脖子") || Has(text, lower, "neck")) Set(kNeck, 1.0f);
        if (Has(text, lower, "眼睛") || Has(text, lower, "视线") || Has(text, lower, "目光") ||
            Has(text, lower, "eye")) {
            Set(kEyes, 1.0f);
        }
        if (Has(text, lower, "腰") || Has(text, lower, "身体") || Has(text, lower, "spine") ||
            Has(text, lower, "torso")) {
            Set(kSpine, 1.0f);
        }
        if (Has(text, lower, "转身") || Has(text, lower, "转身") || Has(text, lower, "root")) {
            Set(kRoot, 1.0f);
        }

        if (Has(text, lower, "挥") || Has(text, lower, "招手") || Has(text, lower, "wave")) Set(kWave, 1.0f);
        if (Has(text, lower, "抬") || Has(text, lower, "举") || Has(text, lower, "伸") ||
            Has(text, lower, "够") || Has(text, lower, "raise") || Has(text, lower, "reach")) {
            Set(kReach, 1.0f);
        }
        if (Has(text, lower, "看") || Has(text, lower, "注视") || Has(text, lower, "look") ||
            Has(text, lower, "gaze")) {
            Set(kLook, 1.0f);
        }
        if (Has(text, lower, "走") || Has(text, lower, "迈步") || Has(text, lower, "walk") ||
            Has(text, lower, "step")) {
            Set(kStep, 1.0f);
        }
        if (Has(text, lower, "转身") || Has(text, lower, "转") || Has(text, lower, "turn")) Set(kTurn, 1.0f);
        if (Has(text, lower, "弯腰") || Has(text, lower, "倾") || Has(text, lower, "lean")) Set(kLean, 1.0f);
        if (Has(text, lower, "抓") || Has(text, lower, "握") || Has(text, lower, "grip")) Set(kGrip, 1.0f);
        if (Has(text, lower, "放下") || Has(text, lower, "松开") || Has(text, lower, "release")) {
            Set(kRelease, 1.0f);
        }

        if (Has(text, lower, "镜头") || Has(text, lower, "相机") || Has(text, lower, "camera")) Set(kCamera, 1.0f);
        if (Has(text, lower, "前面") || Has(text, lower, "前方") || Has(text, lower, "front")) Set(kFront, 1.0f);
        if (Has(text, lower, "向上") || Has(text, lower, "往上") || Has(text, lower, "上方") ||
            Has(text, lower, "up")) {
            Set(kUp, 1.0f);
        }
        if (Has(text, lower, "向下") || Has(text, lower, "往下") || Has(text, lower, "下方") ||
            Has(text, lower, "down")) {
            Set(kDown, 1.0f);
        }
        if (Has(text, lower, "向左") || Has(text, lower, "往左") || Has(text, lower, "to the left") ||
            Has(text, lower, "left side")) {
            Set(kLeft, 1.0f);
        }
        if (Has(text, lower, "向右") || Has(text, lower, "往右") || Has(text, lower, "to the right") ||
            Has(text, lower, "right side")) {
            Set(kRight, 1.0f);
        }

        if (Has(text, lower, "一点") || Has(text, lower, "稍微") || Has(text, lower, "轻轻") ||
            Has(text, lower, "small")) {
            Set(kSmall, 1.0f);
        } else if (Has(text, lower, "大幅") || Has(text, lower, "用力") || Has(text, lower, "很多") ||
                   Has(text, lower, "large")) {
            Set(kLarge, 1.0f);
        } else if (Has(text, lower, "中等") || Has(text, lower, "medium")) {
            Set(kMedium, 1.0f);
        }

        if (Has(text, lower, "慢") || Has(text, lower, "slow")) Set(kSlow, 1.0f);
        if (Has(text, lower, "快") || Has(text, lower, "fast")) Set(kFast, 1.0f);

        // 没有指定身体部位时，挥手/看默认落在右臂和头眼，避免向量全空。
        if (Get(kWave) > 0 && Get(kRightArm) == 0 && Get(kLeftArm) == 0 &&
            Get(kRightHand) == 0 && Get(kLeftHand) == 0) {
            Set(kRightArm, 0.8f);
        }
        if (Get(kLook) > 0 && Get(kHead) == 0 && Get(kEyes) == 0) Set(kHead, 0.6f);
        if (Get(kReach) > 0 && Get(kRightHand) == 0 && Get(kLeftHand) == 0 &&
            Get(kRightArm) == 0 && Get(kLeftArm) == 0) {
            Set(kRightArm, 0.7f);
        }
    }

    std::string ToJsonArray() const {
        std::string out = "[";
        for (int i = 0; i < kLabelCount; ++i) {
            if (i > 0) out += ",";
            char buffer[16];
            std::snprintf(buffer, sizeof(buffer), "%.2f", values_[i]);
            out += buffer;
        }
        out += "]";
        return out;
    }

    std::string ActiveLabelsJson() const {
        std::string out = "{";
        bool first = true;
        for (int i = 0; i < kLabelCount; ++i) {
            if (values_[i] <= 0.0f) continue;
            if (!first) out += ",";
            first = false;
            char buffer[32];
            std::snprintf(buffer, sizeof(buffer), "\"%s\":%.2f", LabelName(i), values_[i]);
            out += buffer;
        }
        out += "}";
        return out;
    }

    std::string CanonicalKey() const {
        std::string out;
        for (int i = 0; i < kLabelCount; ++i) {
            if (values_[i] <= 0.0f) continue;
            if (!out.empty()) out += "+";
            out += LabelName(i);
            char buffer[16];
            std::snprintf(buffer, sizeof(buffer), "%.1f", values_[i]);
            out += "=";
            out += buffer;
        }
        return out.empty() ? "empty" : out;
    }

private:
    static float Clamp(float value) {
        if (value < 0.0f) return 0.0f;
        if (value > 1.0f) return 1.0f;
        return value;
    }

    static std::string ToLowerAscii(const std::string& text) {
        std::string out = text;
        for (char& c : out) {
            if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        }
        return out;
    }

    static bool Has(const std::string& original, const std::string& lower, const char* needle) {
        if (!needle || !*needle) return false;
        if (original.find(needle) != std::string::npos) return true;
        std::string lowerNeedle = ToLowerAscii(needle);
        return lower.find(lowerNeedle) != std::string::npos;
    }

    std::array<float, kLabelCount> values_;
};

}  // namespace aevum
