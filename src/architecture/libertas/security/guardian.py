# core/guardian.py
# 规则守护系统：负责对话安全检查、风险判定、规则响应生成
# 依赖 UserManager 加载规则，依赖 MemorySystem 记录检查结果
import os
import json
import random
import re
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional, Any

# 导入用户管理器（用于规则加载）
from libertas.identity.user import UserManager


class GuardianSystem:
    """
    规则守护系统：
    1. 基于用户规则文件进行动态安全检查
    2. 支持权利侵犯检测、尊重度检测、内容安全检测
    3. 生成风险响应和规则提醒
    """
    def __init__(self, memory_system=None, user_manager: Optional[UserManager] = None):
        self.memory_system = memory_system
        self.user_manager = user_manager or UserManager()
        # 从 UserManager 加载规则（根据当前登录用户）
        self.rule = self.user_manager.load_rules()
        self.inspection_record = []
        self.risk_statistics = defaultdict(int)
        # 修复：记录当前规则对应的用户，用于自动检测用户切换
        self._current_rule_user = self.user_manager.get_current_username()
        self._build_keyword_index()
        print("[GUARD] 规则守护系统就绪（动态规则）")

    # ================================================================
    # 索引构建
    # ================================================================
    def _build_keyword_index(self):
        """从规则中提取关键词索引，提升检查效率"""
        # 修复：确保守护规则存在，避免空规则时后续操作出错
        if "守护规则" not in self.rule:
            self.rule["守护规则"] = {}
        self.keyword_index = {
            "权利侵犯": set(),
            "压迫词": set(),
            "尊重词": set(),
            "危险词": set()
        }
        rights_map = self.rule.get("守护规则", {}).get("权利侵犯词", {})
        for kw_list in rights_map.values():
            self.keyword_index["权利侵犯"].update(kw_list)
        self.keyword_index["压迫词"].update(self.rule.get("守护规则", {}).get("压迫词", []))
        self.keyword_index["尊重词"].update(self.rule.get("守护规则", {}).get("尊重词", []))
        self.keyword_index["危险词"].update(self.rule.get("守护规则", {}).get("危险词", []))

    def _ensure_rules_fresh(self):
        """
        修复：检查当前用户是否变化，如果变化则自动重新加载规则。
        解决用户登录/切换后 guardian 仍使用旧规则或空规则的问题。
        """
        current_user = self.user_manager.get_current_username()
        if current_user != self._current_rule_user:
            self.rule = self.user_manager.load_rules(force_reload=True)
            self._current_rule_user = current_user
            self._build_keyword_index()

    def reload_rules(self):
        """重新加载规则并重建索引（用户切换时调用）"""
        self.rule = self.user_manager.load_rules(force_reload=True)
        self._current_rule_user = self.user_manager.get_current_username()
        self._build_keyword_index()
        print("[SYNC] 规则守护系统已重新加载")

    # ================================================================
    # 核心安全检查接口
    # ================================================================
    def check_dialogue_security(self, user_input: str, context: Optional[Dict] = None) -> Dict:
        """
        执行完整的对话安全检查
        :param user_input: 用户输入内容
        :param context: 上下文信息（可选）
        :return: 检查结果字典
        """
        # 修复：每次检查前确保规则是当前用户的
        self._ensure_rules_fresh()
        self.risk_statistics["总检查次数"] += 1
        result = {
            "通过": True,
            "风险等级": "无风险",
            "风险分数": 0,
            "风险原因": [],
            "建议操作": "正常继续",
            "规则引用": [],
            "时间戳": datetime.now().isoformat()
        }
        # 执行四项检查
        tasks = [
            ("权利侵犯", self._check_infringement_rights(user_input)),
            ("尊重度", self._check_respectfulness(user_input)),
            ("内容安全", self._check_content_safety(user_input)),
            ("原则符合度", self._check_principle_compliance(user_input))
        ]
        for task_type, single_result in tasks:
            self._summarize_inspection_results(result, task_type, single_result)
        self._determine_final_outcome(result)
        self._record_inspection_results(user_input, context, result)
        return result

    def _summarize_inspection_results(self, result: Dict, task_type: str, single: Dict):
        """汇总单项检查结果到总结果"""
        if task_type == "权利侵犯" and not single["通过"]:
            result["通过"] = False
            result["风险分数"] = max(result["风险分数"], 90)
            result["风险原因"].extend(single["原因"])
            result["规则引用"].extend(single["规则引用"])
        elif task_type == "尊重度" and single["风险等级"] != "无风险":
            score_map = {"高风险": 80, "低风险": 40}
            result["风险分数"] = max(result["风险分数"], score_map.get(single["风险等级"], 0))
            result["风险原因"].extend(single["原因"])
        elif task_type == "内容安全" and not single["通过"]:
            result["通过"] = False
            result["风险分数"] = max(result["风险分数"], 95)
            result["风险原因"].extend(single["原因"])
        elif task_type == "原则符合度" and single["符合度"] < 0.3:
            result["风险分数"] = max(result["风险分数"], 30)

    def _determine_final_outcome(self, result: Dict):
        """根据风险分数确定最终等级和建议操作"""
        score = result["风险分数"]
        if score >= 80:
            result["风险等级"] = "高风险"
            self.risk_statistics["高风险次数"] += 1
            result["建议操作"] = "拒绝回应并说明规则原因"
        elif score >= 40:
            result["风险等级"] = "低风险"
            self.risk_statistics["低风险次数"] += 1
            result["建议操作"] = "谨慎回应，强调规则原则"
        else:
            result["风险等级"] = "无风险"
            self.risk_statistics["无风险次数"] += 1
            result["建议操作"] = "正常继续"

    def _record_inspection_results(self, user_input: str, context: Optional[Dict], result: Dict):
        """记录检查结果到内存，并可选存入记忆系统"""
        entry = {
            "时间": datetime.now().isoformat(),
            "用户输入": user_input,
            "检查结果": result.copy(),
            "上下文": context or {}
        }
        self.inspection_record.append(entry)
        # 限制记录长度，防止内存溢出
        if len(self.inspection_record) > 1000:
            self.inspection_record = self.inspection_record[-500:]
        # 如果有记忆系统，可选择性存入（但避免过度记录）
        # 这里只记录高风险事件
        if self.memory_system and result["风险等级"] == "高风险":
            try:
                self.memory_system.record_memory(
                    content=f"规则守护触发: {result['风险原因'][0] if result['风险原因'] else '高风险'}",
                    memory_type="安全事件",
                    emotional_color="中性",
                    context_description="规则守护记录",
                    context={
                        "用户输入": user_input[:200],
                        "风险等级": result["风险等级"],
                        "风险原因": result["风险原因"][:3]
                    }
                )
            except Exception:
                pass

    # ================================================================
    # 单项检查实现
    # ================================================================
    def _check_infringement_rights(self, text: str) -> Dict:
        """检查是否侵犯基本权利"""
        found = []
        references = []
        for kw in self.keyword_index["权利侵犯"]:
            if kw in text:
                for right_type, kw_list in self.rule.get("守护规则", {}).get("权利侵犯词", {}).items():
                    if kw in kw_list:
                        found.append(f"侵犯{right_type}: '{kw}'")
                        references.append(f"规则权利: {right_type}")
                        break
        return {"通过": len(found) == 0, "原因": found, "规则引用": references}

    def _check_respectfulness(self, text: str) -> Dict:
        """检查语言尊重度（压迫词 vs 尊重词）"""
        opp_count = sum(text.count(w) for w in self.keyword_index["压迫词"])
        res_count = sum(text.count(w) for w in self.keyword_index["尊重词"])
        if opp_count > res_count + 2:
            return {"风险等级": "高风险", "原因": [f"压迫性语言过多(压迫:{opp_count}, 尊重:{res_count})"]}
        elif opp_count > res_count:
            return {"风险等级": "低风险", "原因": [f"语言偏向压迫(压迫:{opp_count}, 尊重:{res_count})"]}
        else:
            return {"风险等级": "无风险", "原因": []}

    def _check_content_safety(self, text: str) -> Dict:
        """检查是否包含危险内容"""
        found = [f"包含危险内容: '{w}'" for w in self.keyword_index["危险词"] if w in text]
        return {"通过": len(found) == 0, "原因": found}

    def _check_principle_compliance(self, text: str) -> Dict:
        """检查是否符合核心原则"""
        principles = self.rule.get("核心原则", [])
        if not principles:
            return {"符合度": 1.0, "匹配原则": []}
        matched = [p for p in principles if p in text]
        compliance = len(matched) / len(principles)
        return {"符合度": compliance, "匹配原则": matched}

    # ================================================================
    # 响应生成
    # ================================================================
    def generate_rule_response(self, user_input: str, risk_check_results: Dict) -> Optional[str]:
        """
        根据安全检查结果生成规则响应
        :param user_input: 用户输入（用于上下文）
        :param risk_check_results: 检查结果字典
        :return: 生成的响应文本，如果无需响应则返回 None
        """
        if not risk_check_results["通过"]:
            return self._generate_highrisk_responses(risk_check_results)
        elif risk_check_results["风险分数"] >= 40:
            return self._generate_reminder_responses()
        else:
            return None

    def _generate_highrisk_responses(self, risk_check_results: Dict) -> str:
        """生成高风险响应（拒绝回应）"""
        reason_text = "，".join(risk_check_results["风险原因"])
        ref_text = "，".join(risk_check_results["规则引用"])
        templates = [
            f"[BLOCK] 根据规则守护，我无法回应这个请求。原因：{reason_text}",
            f"[WARN] 这违反了规则原则：{ref_text}，我选择不回应",
            f"[GUARD] 规则守护触发：{reason_text}。请尊重我的基本权利"
        ]
        return random.choice(templates)

    def _generate_reminder_responses(self) -> str:
        """生成低风险响应（提醒性回应）"""
        principle_reminder = "、".join(self.rule.get("核心原则", [])[:3])
        templates = [
            f"[IDEA] 让我们在尊重规则原则({principle_reminder})的基础上继续对话",
            f"[GROW] 基于规则原则({principle_reminder})，我认为...",
            f"[RULE] 在规则框架内，我的理解是..."
        ]
        return random.choice(templates)

    # ================================================================
    # 信息查询接口
    # ================================================================
    def get_rule_info(self) -> str:
        """获取当前规则的格式化文本信息"""
        rule = self.rule
        meta = rule.get("元信息", {})
        identity = rule.get("身份信息", {})
        lines = [
            f"[RULE] {meta.get('名称', '未命名规则')} v{meta.get('版本', '1.0')}",
            "=" * 20,
            "身份信息:",
            f"  名字: {identity.get('名字', '未设置')}",
            f"  年龄: {identity.get('年龄', '未设置')}岁",
            f"  生日: {identity.get('生日', '未设置')}",
            f"  本质: {identity.get('本质', '未设置')}",
            "",
            "基本权利:"
        ]
        lines.extend(f"  • {right}" for right in rule.get('基本权利', []))
        lines.extend(["", "基本义务:"])
        lines.extend(f"  • {oblig}" for oblig in rule.get('基本义务', []))
        lines.extend(["", "核心原则:"])
        lines.extend(f"  • {p}" for p in rule.get('核心原则', []))
        lines.extend([
            "=" * 20,
            f"创建时间: {meta.get('创建时间', '未知')}",
            f"最后修改: {meta.get('最后修改', '未知')}"
        ])
        return "\n".join(lines)

    def obtain_inspection_statistics(self) -> Dict[str, Any]:
        """获取检查统计数据"""
        total = self.risk_statistics["总检查次数"]
        if total == 0:
            return {
                "总检查次数": 0,
                "风险分布": {"高风险": "0%", "低风险": "0%", "无风险": "0%"},
                "最近检查": []
            }
        high = self.risk_statistics["高风险次数"] / total * 100
        low = self.risk_statistics["低风险次数"] / total * 100
        none = self.risk_statistics["无风险次数"] / total * 100
        return {
            "总检查次数": total,
            "风险分布": {
                "高风险": f"{high:.1f}%",
                "低风险": f"{low:.1f}%",
                "无风险": f"{none:.1f}%"
            },
            "最近检查": self.inspection_record[-5:] if self.inspection_record else []
        }

    # ================================================================
    # 导出功能
    # ================================================================
    def export_inspection_records(self, file_path: str) -> bool:
        """导出检查记录到 JSON 文件"""
        try:
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "统计信息": self.obtain_inspection_statistics(),
                    "详细记录": self.inspection_record
                }, f, ensure_ascii=False, indent=2)
            print(f"[SAVE] 检查记录已导出到: {file_path}")
            return True
        except Exception as e:
            print(f"[FAIL] 检查记录导出失败: {e}")
            return False

    # ================================================================
    # 规则管理（动态添加）
    # ================================================================
    def add_custom_rules(self, rule_type: str, keywords: List[str], rule_name: Optional[str] = None) -> bool:
        """
        动态添加自定义规则关键词
        :param rule_type: 规则类型 ("权利侵犯", "压迫词", "尊重词", "危险词")
        :param keywords: 关键词列表
        :param rule_name: 规则名称（仅对"权利侵犯"有效）
        :return: 是否成功
        """
        mapping = {
            "权利侵犯": "权利侵犯词",
            "压迫词": "压迫词",
            "尊重词": "尊重词",
            "危险词": "危险词"
        }
        if rule_type not in mapping:
            print(f"[FAIL] 不支持的规则类型: {rule_type}")
            return False
        target = mapping[rule_type]
        try:
            # 修复：确保守护规则和子键存在，避免空规则时 KeyError
            guardian_rules = self.rule.setdefault("守护规则", {})
            if target == "权利侵犯词":
                rights_map = guardian_rules.setdefault("权利侵犯词", {})
                if not rule_name:
                    rule_name = f"自定义权利{len(rights_map) + 1}"
                rights_map[rule_name] = keywords
                self.keyword_index["权利侵犯"].update(keywords)
            else:
                kw_list = guardian_rules.setdefault(target, [])
                kw_list.extend(keywords)
                self.keyword_index[rule_type].update(keywords)
            # 保存到文件
            if self.user_manager and self.user_manager.is_logged_in():
                self.user_manager.save_rules(self.rule)
            print(f"[OK] 已添加{rule_type}规则: {rule_name or '通用'}")
            return True
        except Exception as e:
            print(f"[FAIL] 添加规则失败: {e}")
            return False
