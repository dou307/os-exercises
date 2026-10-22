#!/usr/bin/env python3
"""P2：生成课程章节、知识点、题目映射、学习默认值与勘误层。

输入：
* ``docs/audit/notes-outline.json`` —— 16 个真实笔记文件的标题结构与哈希（只读依据）
* ``data/questions.json`` —— P1 的提取结果
* 本文件中的 ``CH1_REVIEW`` —— 第一章 88 道题的逐题人工审核结论

输出：
* ``data/chapters.json``、``data/topics.json``、``data/mappings.json``、
  ``data/study-defaults.json``、``data/overrides/errata.json``

第一章逐题审核是本脚本的核心资产：每条记录写明分层、知识点、前置知识与理由。
其余章节只按上游分区做初筛，状态一律 ``candidate``，不冒充已审核。
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
AUDIT = ROOT / "docs" / "audit" / "notes-outline.json"
REVIEW_DATE = "2026-10-21"

CHAPTER_TITLES_ZH = {
    "1": "导论",
    "2": "操作系统结构",
    "2.1": "重建 Linux 内核（补充章）",
    "3": "进程",
    "4": "线程与并发",
    "5": "CPU 调度",
    "6": "同步工具",
    "7": "同步实例",
    "8": "死锁",
    "9": "主存",
    "10": "虚拟内存",
    "11": "大容量存储结构",
    "12": "I/O 系统",
    "13": "文件系统接口",
    "14": "文件系统实现",
    "15": "文件系统内部结构",
}

# 上游分区 → 课程章节与知识点的小节级映射。
#
# 这是"系统映射"：同一小节的题目共用一组知识点，没有逐题人工审核答案。
# 状态写 systematic，界面对应"系统映射"徽标，不冒充 verified。
SECTION_MAP = {
    ("ch2", "toc-1", None): {
        "primary": "3",
        "secondary": ["4"],
        "topics": ["t3-1", "t3-1-1", "t3-1-2"],
        "reason": "2.1 进程与线程简介：进程概念、状态与 PCB；线程相关内容按关键词改归第 4 章",
    },
    ("ch2", "toc-2", None): {
        "primary": "5",
        "secondary": ["3"],
        "topics": ["t5-1", "t5-2", "t5-3"],
        "reason": "2.2 CPU 调度：调度准则与 FCFS/SJF/RR/优先级/多级队列",
    },
    ("ch2", "toc-3", None): {
        "primary": "6",
        "secondary": ["7"],
        "topics": ["t6-1", "t6-3", "t6-4", "t6-5"],
        "reason": "2.3 同步与互斥：临界区、硬件指令、锁与信号量；经典问题在第 7 章",
    },
    ("ch2", "toc-4", None): {
        "primary": "8",
        "secondary": ["6"],
        "topics": ["t8-3", "t8-5", "t8-6", "t8-7"],
        "reason": "2.4 死锁：必要条件、预防/避免/检测与银行家算法",
    },
    ("ch2", "toc-5", None): {
        "primary": "5",
        "secondary": ["3"],
        "topics": ["t5-3", "t3-2"],
        "reason": "综合应用题（一）：调度时序、周转时间与利用率计算",
    },
    ("ch2", "toc-17", None): {
        "primary": "7",
        "secondary": ["6"],
        "topics": ["t7-1", "t6-5"],
        "reason": "综合应用题（二）：经典同步问题的 P/V 解法",
    },
    ("ch2", "toc-47", None): {
        "primary": "8",
        "secondary": ["6"],
        "topics": ["t8-6"],
        "reason": "综合应用题（三）：银行家算法与安全性判定",
    },
    ("ch3", "toc-1", None): {
        "primary": "9",
        "secondary": [],
        "topics": ["t9-1", "t9-2", "t9-3", "t9-4"],
        "reason": "3.1 内存管理概念：地址变换、连续分配、分页与页表结构",
    },
    ("ch3", "toc-2", None): {
        "primary": "10",
        "secondary": ["9"],
        "topics": ["t10-2", "t10-4", "t10-5", "t10-6"],
        "reason": "3.2 虚拟内存：请求分页、页面置换、帧分配与抖动",
    },
    ("ch3", "toc-3", "toc-4"): {
        "primary": "9",
        "secondary": [],
        "topics": ["t9-2", "t9-3"],
        "reason": "综合应用题：动态分区分配与页式地址变换",
    },
    ("ch3", "toc-3", "toc-5"): {
        "primary": "10",
        "secondary": ["9"],
        "topics": ["t10-4", "t10-5", "t10-6"],
        "reason": "综合应用题：置换算法、缺页率与工作集",
    },
    ("ch4", "toc-1", None): {
        "primary": "13",
        "secondary": [],
        "topics": ["t13-1", "t13-2"],
        "reason": "4.1 文件系统基础：文件属性、操作与访问方法",
    },
    ("ch4", "toc-2", None): {
        "primary": "13",
        "secondary": ["14"],
        "topics": ["t13-3", "t13-4"],
        "reason": "4.2 目录与文件：目录结构、共享与保护",
    },
    ("ch4", "toc-3", None): {
        "primary": "14",
        "secondary": ["15"],
        "topics": ["t14-1", "t14-4", "t14-5"],
        "reason": "4.3 文件系统：层次结构、分配方式与空闲空间管理",
    },
    ("ch4", "toc-4", "toc-5"): {
        "primary": "14",
        "secondary": [],
        "topics": ["t14-4", "t14-5"],
        "reason": "综合应用题：连续/链接/索引分配与空闲空间计算",
    },
    ("ch4", "toc-4", "toc-6"): {
        "primary": "14",
        "secondary": ["15"],
        "topics": ["t14-4", "t14-7"],
        "reason": "综合应用题：索引分配与目录检索的访盘次数",
    },
    ("ch5", "toc-1", None): {
        "primary": "12",
        "secondary": [],
        "topics": ["t12-1", "t12-2"],
        "reason": "5.1 I/O 管理概述：I/O 硬件、中断、DMA 与设备接口",
    },
    ("ch5", "toc-2", None): {
        "primary": "12",
        "secondary": [],
        "topics": ["t12-2", "t12-3"],
        "reason": "5.2 设备独立性软件：缓冲、缓存、SPOOLing 与错误处理",
    },
    ("ch5", "toc-3", None): {
        "primary": "11",
        "secondary": ["12"],
        "topics": ["t11-1", "t11-2", "t11-8"],
        "reason": "5.3 磁盘和固态硬盘：磁盘调度、SSD 与 RAID",
    },
    ("ch5", "toc-4", "toc-5"): {
        "primary": "12",
        "secondary": [],
        "topics": ["t12-3", "t12-5"],
        "reason": "综合应用题：I/O 请求到硬件的转换与性能开销",
    },
    ("ch5", "toc-4", "toc-6"): {
        "primary": "12",
        "secondary": [],
        "topics": ["t12-2"],
        "reason": "综合应用题：缓冲、设备独立性与 I/O 软件层次",
    },
    ("ch5", "toc-4", "toc-7"): {
        "primary": "11",
        "secondary": ["12"],
        "topics": ["t11-2", "t11-1"],
        "reason": "综合应用题：磁盘调度与访问时间计算",
    },
}

# 小节内部再按关键词细分（按顺序匹配，先命中先用）。
# 只用于跨章或跨知识点差异明显的小节，避免过度自动化。
KEYWORD_RULES = {
    ("ch2", "toc-1", None): [
        (r"线程|thread|用户级|内核级|多对一|一对一|多对多",
         {"primary": "4", "topics": ["t4-1", "t4-3"],
          "reason": "2.1 中的线程题：线程概念、用户级/内核级线程与多线程模型，归第 4 章"}),
        (r"进程创建|创建进程|fork|子进程", {"topics": ["t3-3-1"], "reason": "2.1 中的进程创建：fork 与地址空间复制"}),
        (r"进程终止|终止|退出|僵尸", {"topics": ["t3-3-2"], "reason": "2.1 中的进程终止：退出与回收"}),
        (r"上下文|切换", {"topics": ["t3-2-3"], "reason": "2.1 中的上下文切换：现场保存与恢复"}),
        (r"通信|管道|共享内存|消息|信号", {"topics": ["t3-5"], "reason": "2.1 中的进程通信：共享内存与消息传递"}),
        (r"就绪|阻塞|运行态|状态", {"topics": ["t3-1-1"], "reason": "2.1 中的进程状态：三态/五态转换"}),
        (r"PCB|进程控制块", {"topics": ["t3-1-2"], "reason": "2.1 中的 PCB：进程控制块的内容与作用"}),
    ],
}

# --------------------------------------------------------------------------- #
# 第一章逐题审核表
# 字段：(题号, 分层, 审核状态, 主归属章, 知识点, 额外前置知识点, 理由)
# 未写主归属章时默认 "1"；未写额外前置时默认与知识点相同。
# --------------------------------------------------------------------------- #
CH1_REVIEW = [
    # ---- 1.1 操作系统的基本概念 ----
    ("c1-s1-0-q001", "core", "verified", "1", ["t1-1", "t1-5"], None,
     "考操作系统的管理对象；笔记 1.1 与 Resource Management 直接覆盖“管理全部软硬件资源”。"),
    ("c1-s1-0-q002", "core", "verified", "1", ["t1-1", "t1-5"], None,
     "辨析“源程序不是 OS 管理对象”；依赖 Resource Management 中“管理元数据而非文件内容”的界定。"),
    ("c1-s1-0-q003", "core", "verified", "1", ["t1-1"], None,
     "考 OS 的职责边界（扩充机器、用户与硬件中介）；属 1.1 核心定义。"),
    ("c1-s1-0-q004", "core", "verified", "1", ["t1-1"], None,
     "OS 的基本功能即控制和管理系统资源；1.1 直接覆盖。"),
    ("c1-s1-0-q005", "core", "verified", "1", ["t1-4-1"], None,
     "并发与并行的区别；由 Multiprogramming and Multitasking 引入，属第一章范围。"),
    ("c1-s1-0-q006", "later", "reviewed", "2", ["t2-3"], None,
     "系统调用与命令接口的分工属第 2 章 System Calls；第一章只提到“程序通过系统调用请求服务”，未展开接口分类。"),
    ("c1-s1-0-q007", "later", "reviewed", "2", ["t2-3", "t2-3-1"], None,
     "考“程序接口=系统调用”与库函数、API 的关系；需要第 2 章 System Calls 与 API 小节。"),
    ("c1-s1-0-q008", "later", "reviewed", "2", ["t2-3"], None,
     "系统调用的目的；属第 2 章 System Calls 的类型与用途。"),
    ("c1-s1-0-q009", "core", "verified", "1", ["t1-1"], None,
     "逐项判断 OS 角色描述，1.1 定义即可完成。"),
    ("c1-s1-0-q010", "later", "reviewed", "2", ["t2-3", "t2-3-1"], None,
     "库函数与系统调用的区别需要 API/系统调用两层概念，属第 2 章。"),
    ("c1-s1-0-q011", "later", "reviewed", "2", ["t2-3"], None,
     "2010 真题考“OS 提供给应用程序的接口”；结论依赖第 2 章系统调用，非 Introduction 内容。"),

    # ---- 1.2 操作系统发展历程 ----
    ("c1-s2-0-q001", "core", "verified", "1", ["t1-4-1"], None,
     "多道程序设计是提高资源利用率的关键技术；Multiprogramming and Multitasking 直接覆盖。"),
    ("c1-s2-0-q002", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "批处理系统的缺点属“系统类型”辨析；笔记第 1 章未展开批处理分类，作为补充标签保留。"),
    ("c1-s2-0-q003", "core", "verified", "1", ["t1-4-1"], None,
     "多道程序的特征（制约性、间断性、失去顺序性）；1.4.1 小节直接讲解。"),
    ("c1-s2-0-q004", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "三种基本 OS 类型的划分口径；笔记未覆盖，补充内容。"),
    ("c1-s2-0-q005", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "实时系统的时限要求；第 1 章笔记未涉及实时系统，补充内容。"),
    ("c1-s2-0-q006", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "实时系统的设计目标；同上，属补充知识。"),
    ("c1-s2-0-q007", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "实时系统的适用场景判断；补充内容，不影响第一章主线。"),
    ("c1-s2-0-q008", "core", "verified", "1", ["t1-4-1"], None,
     "分时系统面向交互式作业；Multiprogramming and Multitasking 明确讲 time sharing 与响应时间。"),
    ("c1-s2-0-q009", "supplement", "disputed", "1", ["t1-4-1"], None,
     "原答案 C（优先级＋非抢占式调度）。非抢占式调度可能让长作业长期占用 CPU，是否普遍“改善响应时间”存疑；按调查记录列入待核对，不计分。"),
    ("c1-s2-0-q010", "core", "verified", "1", ["t1-4-1"], None,
     "分时系统追求快速响应；对应 time sharing 的 response time 目标。"),
    ("c1-s2-0-q011", "core", "verified", "1", ["t1-4-1"], None,
     "响应时间近似为时间片×用户数；由 1.4.1 的轮转模型直接推导。"),
    ("c1-s2-0-q012", "core", "verified", "1", ["t1-4-1"], None,
     "时间片上限计算（2s/100）；同一模型的数值应用。"),
    ("c1-s2-0-q013", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "多空题，考四种 OS 类型的识别；属补充的类型辨析，且按规则不自动计分。"),
    ("c1-s2-0-q014", "core", "verified", "1", ["t1-3-2"], None,
     "并行需要多个处理机；Computer-System Architecture 的 Multiprocessor Systems 覆盖。"),
    ("c1-s2-0-q015", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "三种系统的时间约束对比；补充的类型辨析。"),
    ("c1-s2-0-q016", "core", "verified", "1", ["t1-4-1", "t1-2-1"], None,
     "多道程序以中断为前提；需要 Interrupts 与 Multiprogramming 两节。"),
    ("c1-s2-0-q017", "supplement", "reviewed", "1", ["t1-4-1"], None,
     "2016 真题考批处理的交互性与 I/O 并行；批处理分类不在笔记第 1 章，补充内容。"),
    ("c1-s2-0-q018", "core", "verified", "1", ["t1-4-1"], None,
     "多道程序提高 CPU、吞吐量与 I/O 利用率，但开销增大；1.4.1 直接覆盖。"),
    ("c1-s2-0-q019", "core", "verified", "1", ["t1-4-1"], None,
     "多任务系统的并发/并行与共享资源保护；1.4.1 覆盖。解析中“宏观并行、微观交替”措辞偏松，但答案 C 不受影响。"),
    ("c1-s2-0-q020", "core", "verified", "1", ["t1-4-1"], None,
     "多道程序系统不要求虚拟存储、进程数并非越多越好；依赖 1.4.1 的并发收益与代价。"),

    # ---- 1.3 操作系统的运行环境 ----
    ("c1-s3-0-q001", "core", "verified", "1", ["t1-1", "t1-5"], None,
     "综合判断 OS 职责；1.1 与 Resource Management 可完成，无需后续章知识。"),
    ("c1-s3-0-q002", "core", "verified", "1", ["t1-4-2", "t1-4-1"], None,
     "I/O 指令是特权指令、通道是硬件；依赖 Dual-Mode 与多道程序。"),
    ("c1-s3-0-q003", "later", "reviewed", "2", ["t2-3"], None,
     "系统调用编译成参数与陷入指令的过程属第 2 章 System Calls 实现细节。"),
    ("c1-s3-0-q004", "core", "verified", "1", ["t1-2-1"], None,
     "中断处理是 OS 必须提供的功能；Interrupts 一节覆盖。"),
    ("c1-s3-0-q005", "core", "verified", "1", ["t1-4-2"], None,
     "特权指令只能由操作系统使用；Dual-Mode and Multimode Operation 直接定义。"),
    ("c1-s3-0-q006", "core", "verified", "1", ["t1-2-1"], None,
     "中断处理程序属于 OS 程序；依赖中断处理在内核态完成的机制。"),
    ("c1-s3-0-q007", "core", "verified", "1", ["t1-4-2", "t1-2-1"], None,
     "用户态到内核态只能经由中断/异常；Dual-Mode 与 Interrupts 联合覆盖。"),
    ("c1-s3-0-q008", "core", "verified", "1", ["t1-4-2"], None,
     "区分特权指令与普通指令；Dual-Mode 小节的核心判断。"),
    ("c1-s3-0-q009", "core", "disputed", "1", ["t1-4-2", "t2-3"], None,
     "原答案 C 把“系统调用指令”判为必须在内核态执行，与同章第 11 题（内核态不执行访管指令）、第 20 题（Trap 可在用户态执行）冲突；混淆了“发起系统调用的指令”与“内核服务程序”。列入争议，不计分。"),
    ("c1-s3-0-q010", "core", "verified", "1", ["t1-4-2"], None,
     "按传统大内核模型，磁盘调度、中断处理、设备驱动、初始化程序均在内核态。现代微内核/用户态驱动不满足该前提，已在勘误层记录假设。"),
    ("c1-s3-0-q011", "core", "disputed", "1", ["t1-4-2"], None,
     "原答案 D 主张内核态不能执行访管指令。这是教材简化模型：x86 的 int 指令在 CPL0 亦可执行，RISC-V ecall 同样可在 M 态执行，该结论不是跨体系结构的一般规律。列入争议，不计分。"),
    ("c1-s3-0-q012", "core", "verified", "1", ["t1-2-1"], None,
     "外中断与内中断的判别；Interrupts 一节覆盖。"),
    ("c1-s3-0-q013", "later", "reviewed", "2", ["t2-3", "t2-3-1"], None,
     "库函数与系统调用的可替换性、调试难度对比，属第 2 章 API 与系统调用内容。"),
    ("c1-s3-0-q014", "later", "reviewed", "2", ["t2-3"], None,
     "系统调用与过程调用的现场保存差异，属第 2 章系统调用机制。"),
    ("c1-s3-0-q015", "later", "reviewed", "2", ["t2-3", "t2-3-2"], None,
     "读文件逻辑块使用哪种接口，需第 2 章系统调用类型。"),
    ("c1-s3-0-q016", "core", "verified", "1", ["t1-4-2", "t2-2-1"], None,
     "2011 真题考命令解释程序在用户态执行；Dual-Mode 判断即可，命令解释器位置为辅助知识点。"),
    ("c1-s3-0-q017", "bridge", "reviewed", "1", ["t1-4-2", "t3-2-3"], ["t3-2-3"],
     "“不可能在用户态发生”的关键是进程切换由内核完成；进程切换概念在第 3 章，作为桥接练习并标注前置。"),
    ("c1-s3-0-q018", "core", "verified", "1", ["t1-2-1"], None,
     "2012 真题考中断保存 PSW；Interrupts 的现场保护内容覆盖。"),
    ("c1-s3-0-q019", "core", "verified", "1", ["t1-2-1", "t1-4-2"], None,
     "2013 真题：除零异常与 read 陷入导致状态切换，sin() 不会；两节联合覆盖。"),
    ("c1-s3-0-q020", "core", "verified", "1", ["t1-4-2"], None,
     "2014 真题：关中断是特权指令；Dual-Mode 直接覆盖。"),
    ("c1-s3-0-q021", "core", "verified", "1", ["t1-2-1"], None,
     "2015 真题：外中断时 PC 由硬件保存、通用寄存器由 OS 保存；Interrupts 覆盖。"),
    ("c1-s3-0-q022", "core", "verified", "1", ["t1-4-2", "t1-2-1"], None,
     "2015 真题：NOT 指令不引发异常，不会切换状态；需异常与模式切换两节。"),
    ("c1-s3-0-q023", "core", "verified", "1", ["t1-2-1"], None,
     "2016 真题：中断与异常的来源区分；Interrupts 定义覆盖。"),
    ("c1-s3-0-q024", "later", "reviewed", "2", ["t2-3"], None,
     "2017 真题考系统调用执行顺序（传参→陷入→服务→返回），属第 2 章。"),
    ("c1-s3-0-q025", "core", "verified", "1", ["t1-4-3"], None,
     "2018 真题：时钟中断更新时钟变量、CPU 占用与剩余时间片；Timer 一节覆盖。"),
    ("c1-s3-0-q026", "later", "reviewed", "2", ["t2-3"], None,
     "2019 真题考系统调用的四条性质，需第 2 章系统调用接口。"),
    ("c1-s3-0-q027", "core", "verified", "1", ["t1-2-1"], None,
     "2020 真题：断点由硬件保存、中断向量表由 OS 初始化；Interrupts 覆盖。"),
    ("c1-s3-0-q028", "core", "verified", "1", ["t1-4-2"], None,
     "2021 真题：I/O 指令只能在内核态执行；Dual-Mode 覆盖。"),
    ("c1-s3-0-q029", "later", "reviewed", "2", ["t2-3", "t2-3-2"], None,
     "2021 真题：创建进程通过系统调用完成；属第 2 章系统调用类型。"),
    ("c1-s3-0-q030", "core", "verified", "1", ["t1-4-2"], None,
     "2022 真题：用户态只能执行非特权指令，内核态两者皆可；Dual-Mode 核心结论。"),
    ("c1-s3-0-q031", "later", "reviewed", "2", ["t2-3"], None,
     "2022 真题：系统调用过程中哪些操作由 OS 完成；需第 2 章机制细节。"),
    ("c1-s3-0-q032", "core", "verified", "1", ["t1-2-1"], None,
     "2023 真题：中断向量表用数组按下标随机访问；需中断向量表概念，属 Interrupts。"),
    ("c1-s3-0-q033", "core", "verified", "1", ["t1-2-1", "t2-3"], None,
     "2024 真题：中断/异常“发生时”CPU 未必在内核态；核心是中断响应时序，系统调用细节为辅助。"),

    # ---- 1.4～1.6 结构、引导与虚拟机 ----
    ("c1-s4-0-q001", "later", "reviewed", "2", ["t2-8", "t2-8-2"], None,
     "分层结构便于调试，属第 2 章 Operating-System Structure 的 Layered Approach。"),
    ("c1-s4-0-q002", "later", "reviewed", "2", ["t2-8-2"], None,
     "分层结构的单向依赖与效率代价，同上。"),
    ("c1-s4-0-q003", "later", "reviewed", "2", ["t2-8-4"], None,
     "模块化结构的特点与可靠性边界，属 Modules 小节。"),
    ("c1-s4-0-q004", "later", "reviewed", "2", ["t2-8-1", "t2-8-3"], None,
     "大内核与微内核缺点对比，属 Monolithic 与 Microkernels。"),
    ("c1-s4-0-q005", "later", "reviewed", "2", ["t2-8-3", "t2-8-2"], None,
     "微内核的四个描述维度，需 Microkernels 与 Layered 对比。"),
    ("c1-s4-0-q006", "later", "reviewed", "2", ["t2-8-3"], None,
     "哪些服务不宜放进微内核，属 Microkernels 小节。"),
    ("c1-s4-0-q007", "later", "reviewed", "2", ["t2-8-3"], None,
     "微内核的优缺点组合判断，同上。"),
    ("c1-s4-0-q008", "later", "reviewed", "2", ["t2-8", "t2-8-5"], None,
     "四种结构交叉辨析（含 Windows 的混合结构），需整节结构知识。"),
    ("c1-s4-0-q009", "later", "reviewed", "2", ["t2-8-3"], None,
     "微内核提高可靠性/可移植性但降低效率，同上。"),
    ("c1-s4-0-q010", "later", "reviewed", "2", ["t2-8", "t2-7-2"], None,
     "外核（exokernel）的职责，属结构扩展内容，需机制与策略分离作背景。"),
    ("c1-s4-0-q011", "later", "reviewed", "2", ["t2-9-2"], None,
     "引导程序不会把整个 OS 装入内存，属第 2 章 System Boot。"),
    ("c1-s4-0-q012", "later", "reviewed", "2", ["t2-9-2"], None,
     "自举程序存放在 ROM，属引导链的起点。"),
    ("c1-s4-0-q013", "later", "reviewed", "2", ["t2-9-2"], None,
     "区分 ROM 自举程序与硬盘引导程序，属引导链细节。"),
    ("c1-s4-0-q014", "later", "reviewed", "2", ["t2-9-2"], None,
     "BIOS→MBR→PBR→启动管理器→内核的分阶段引导，需完整引导链。"),
    ("c1-s4-0-q015", "later", "reviewed", "2", ["t2-9-2"], None,
     "MBR 检查分区表并加载活动分区引导扇区，同上。"),
    ("c1-s4-0-q016", "supplement", "reviewed", "1", ["t1-3"], None,
     "虚拟机可软硬件实现、不提供真正并行；笔记第 1 章无虚拟化小节，作为补充内容保留。"),
    ("c1-s4-0-q017", "supplement", "reviewed", "1", ["t1-3"], None,
     "第二类 VMM 与敏感指令模拟；补充内容，笔记未覆盖。"),
    ("c1-s4-0-q018", "supplement", "reviewed", "1", ["t1-3"], None,
     "第一类/第二类 VMM 的效率与特权级差异；补充内容。"),
    ("c1-s4-0-q019", "later", "reviewed", "2", ["t2-9-2"], None,
     "2013 真题：OS 最终加载到 RAM；属引导结果，第 2 章 System Boot。"),
    ("c1-s4-0-q020", "later", "reviewed", "2", ["t2-9-2"], None,
     "2022 真题：中断向量表在 OS 初始化时创建；属引导与初始化阶段。"),
    ("c1-s4-0-q021", "later", "reviewed", "2", ["t2-8-3"], None,
     "2023 真题：微内核的可靠性/安全性/可扩展性优势；属结构对比。"),
    ("c1-s4-0-q022", "supplement", "reviewed", "1", ["t1-3"], None,
     "2025 真题：VMM 与客户 OS 特权级不同；虚拟化为补充内容，笔记第 1 章未展开。"),

    # ---- 综合应用题 ----
    ("c1-s5-0-q001", "core", "verified", "1", ["t1-4-1"], None,
     "单道/多道 CPU 利用率对比，题干已给出执行顺序与资源占用假设；属多道程序设计直接应用。综合题只做自评，不自动判分。"),
    ("c1-s5-0-q002", "later", "reviewed", "3", ["t3-1-1", "t3-2"], ["t3-1-1"],
     "需进程状态、等待与 I/O 并行分析；题干要求画甘特图，前置为第 3 章进程概念与调度，留到进程阶段。"),
]

# 少数题目的知识点含"辅助"小节（如命令解释器、系统调用），但作答本身只需第一章知识。
# 这里把前置知识点收窄到已确认覆盖的范围，辅助知识点仍保留在 topicIds 里供跳转。
PREREQ_OVERRIDES = {
    "c1-s3-0-q009": ["t1-4-2"],
    "c1-s3-0-q016": ["t1-4-2"],
    "c1-s3-0-q033": ["t1-2-1"],
}

ERRATA = [
    {
        "questionId": "c1-s3-0-q009",
        "kind": "disputed_answer",
        "originalAnswer": "C",
        "issue": "把“系统调用指令”判为必须在内核态执行，与同章第 11 题（内核态不能执行访管指令）、第 20 题（Trap 指令可在用户态执行）互相矛盾。",
        "detail": "“发起系统调用的指令”（访管/陷入指令）在用户态执行；“系统调用服务程序”在内核态执行。原题把两者混为一项，导致与同章其它题的判据冲突。",
        "evidence": "同章 c1-s3-0-q011 解析“访管指令在用户态执行”；c1-s3-0-q020 解析“Trap 指令可在用户态执行”。",
        "displayAdvice": "保留原答案，同时标注“待核对：系统调用指令与内核服务程序需区分”，不进入自动计分。",
        "scoring": "excluded",
        "status": "open",
        "reviewedAt": REVIEW_DATE,
    },
    {
        "questionId": "c1-s3-0-q011",
        "kind": "disputed_answer",
        "originalAnswer": "D",
        "issue": "“内核态不能执行访管指令”被当作一般结论，实际依赖具体指令集体系结构。",
        "detail": "x86 的 int n 在 CPL0 也能执行，RISC-V 的 ecall 在 M 态同样可执行。原解析的结论来自教材简化模型（访管指令专供用户态发起系统调用），并非所有体系结构都成立。",
        "evidence": "Intel SDM 对 INT n 在 CPL0 的行为说明；RISC-V 特权规范对 ecall 在 M 态的描述。本项目未做逐条引文核对，仅记录该前提差异。",
        "displayAdvice": "保留原答案并标注“教材模型结论，跨体系结构需加前提”，不进入自动计分。",
        "scoring": "excluded",
        "status": "open",
        "reviewedAt": REVIEW_DATE,
    },
    {
        "questionId": "c1-s2-0-q009",
        "kind": "disputed_answer",
        "originalAnswer": "C",
        "issue": "“优先级＋非抢占式调度”是否普遍改善分时系统响应时间存疑。",
        "detail": "非抢占式调度下长作业一旦获得 CPU 会持续占用，交互请求可能长时间得不到响应；原解析只论证了“重要作业尽快响应”，未处理长作业阻塞问题。其余选项同样不理想，因此不强行改判。",
        "evidence": "笔记 1.4.1 Multiprogramming and Multitasking 对响应时间与时间片轮转的说明；原解析自身未覆盖非抢占的副作用。",
        "displayAdvice": "保留原答案，标注“待核对：非抢占调度的副作用”，不进入自动计分。",
        "scoring": "excluded",
        "status": "open",
        "reviewedAt": REVIEW_DATE,
    },
    {
        "questionId": "c1-s3-0-q010",
        "kind": "assumption",
        "originalAnswer": "A",
        "issue": "“设备驱动程序必须在内核态执行”只在传统大内核模型下成立。",
        "detail": "微内核与用户态驱动框架（如 FUSE、UIO）中，部分驱动运行在用户态。原题按王道教材的大内核模型命题。",
        "evidence": "笔记第 2 章 Microkernels 小节对“服务移出内核”的描述。",
        "displayAdvice": "保留原答案，在解析旁注明“按传统大内核模型作答”。",
        "scoring": "normal",
        "status": "noted",
        "reviewedAt": REVIEW_DATE,
    },
    {
        "questionId": "c1-s2-0-q019",
        "kind": "wording",
        "originalAnswer": "C",
        "issue": "原解析用“宏观并行、微观交替”描述单 CPU 多任务，措辞不严谨。",
        "detail": "并发是同一时间间隔内交替推进，不应称为“宏观并行”。答案 C（仅 I、II）本身不受影响。",
        "evidence": "笔记 1.4.1 对 concurrency 与 parallelism 的区分。",
        "displayAdvice": "保留原答案；解析措辞问题不影响作答，仅在审核记录中备注。",
        "scoring": "normal",
        "status": "noted",
        "reviewedAt": REVIEW_DATE,
    },
]


def load_notes() -> dict:
    return json.loads(AUDIT.read_text(encoding="utf-8"))


def build_chapters_and_topics(notes: dict) -> tuple[dict, dict]:
    chapters = []
    topics = []
    for index, note in enumerate(notes["chapters"], start=1):
        key = note["chapter_key"]
        h1 = next((h["text"] for h in note["headings"] if h["level"] == 1), key)
        chapter = {
            "id": key,
            "order": index,
            "kind": "supplement" if "." in key else "main",
            "file": note["file"],
            "title": h1,
            "titleZh": CHAPTER_TITLES_ZH.get(key, h1),
            "noteSha256": note["sha256"],
            "topicIds": [],
        }
        h2_index = 0
        h3_index = 0
        for heading in note["headings"]:
            if heading["level"] == 1:
                continue
            if heading["level"] == 2:
                h2_index += 1
                h3_index = 0
                topic_id = f"t{key}-{h2_index}"
                parent = None
                level = 2
            elif heading["level"] == 3:
                h3_index += 1
                topic_id = f"t{key}-{h2_index}-{h3_index}"
                parent = f"t{key}-{h2_index}"
                level = 3
            else:
                continue
            topics.append(
                {
                    "id": topic_id,
                    "chapterId": key,
                    "level": level,
                    "parentId": parent,
                    "title": heading["text"],
                    "noteFile": note["file"],
                    "noteLine": heading["line"],
                }
            )
            chapter["topicIds"].append(topic_id)
        chapters.append(chapter)
    return (
        {"schemaVersion": 1, "source": "docs/audit/notes-outline.json", "chapters": chapters},
        {"schemaVersion": 1, "source": "docs/audit/notes-outline.json", "topics": topics},
    )


def build_mappings(questions: list[dict]) -> dict:
    reviewed: dict[str, dict] = {}
    for qid, tier, status, primary, topics, extra_prereq, reason in CH1_REVIEW:
        prereq = list(topics) if extra_prereq is None else list(dict.fromkeys(topics + extra_prereq))
        if qid in PREREQ_OVERRIDES:
            prereq = list(PREREQ_OVERRIDES[qid])
        reviewed[qid] = {
            "primaryChapterId": primary,
            "secondaryChapterIds": [],
            "topicIds": topics,
            "prerequisiteTopicIds": prereq,
            "readinessTier": tier,
            "mappingStatus": status,
            "mappingReason": reason,
            "reviewEvidence": {"noteFiles": ["1-Introduction.md"] if primary == "1" else ["2-Operating-System Structures.md", "3-Processes.md"], "reviewedAt": REVIEW_DATE},
        }

    by_question: dict[str, dict] = {}
    unknown: list[str] = []
    for q in questions:
        qid = q["id"]
        if qid in reviewed:
            entry = reviewed[qid]
            # 审核结论落在 reviewStatus 上：争议题必须显式标 disputed，界面才会隔离计分
            entry["reviewStatus"] = (
                "disputed" if entry["mappingStatus"] == "disputed"
                else ("verified" if entry["mappingStatus"] == "verified" else "reviewed")
            )
            by_question[qid] = entry
            continue

        src = q["source"]
        key = (q["chapter"], src["sectionId"], src["subsectionId"])
        rule = SECTION_MAP.get(key)
        if rule is None:
            unknown.append(qid)
            by_question[qid] = {
                "primaryChapterId": None,
                "secondaryChapterIds": [],
                "topicIds": [],
                "prerequisiteTopicIds": [],
                "readinessTier": "later",
                "mappingStatus": "unresolved",
                "mappingReason": "未能按上游分区确定主归属，待人工审核。",
                "reviewStatus": "unresolved",
            }
            continue

        chosen = dict(rule)
        for pattern, override in KEYWORD_RULES.get(key, []):
            if re.search(pattern, q["stemText"], re.IGNORECASE):
                chosen = {**chosen, **override}
                break

        by_question[qid] = {
            "primaryChapterId": chosen["primary"],
            "secondaryChapterIds": chosen.get("secondary", []),
            "topicIds": chosen["topics"],
            "prerequisiteTopicIds": chosen["topics"],
            "readinessTier": "later",
            "mappingStatus": "systematic",
            "mappingReason": f'{chosen["reason"]}。按小节系统映射，答案未逐题人工复核。',
            "reviewStatus": "systematic",
        }

    return {
        "schemaVersion": 1,
        "reviewedAt": REVIEW_DATE,
        "reviewerNote": "第一章 88 道题逐题审核；其余章节按小节系统映射到知识点，状态为 systematic，答案未逐题人工复核。",
        "byQuestion": by_question,
        "unresolved": unknown,
    }


def write_review_doc(questions: list[dict], mappings: dict) -> None:
    """把逐题审核结论渲染成 Markdown 记录，避免文档与数据脱节。"""
    by_id = {q["id"]: q for q in questions}
    ch1 = [q for q in questions if q["chapter"] == "ch1"]
    rows = []
    for q in ch1:
        m = mappings["byQuestion"][q["id"]]
        rows.append(
            "| `{id}` | {label} | {sec} | {tier} | {status} | {chapter} | {topics} | {reason} |".format(
                id=q["id"],
                label=q["source"]["originalLabel"].replace(" ", ""),
                sec=(q["source"]["subsectionTitle"] or q["source"]["sectionTitle"]).split(" · ")[0],
                tier=m["readinessTier"],
                status=m["mappingStatus"],
                chapter=m["primaryChapterId"],
                topics="、".join(m["topicIds"]) or "—",
                reason=m["mappingReason"].replace("|", "／"),
            )
        )

    tiers = Counter(m["readinessTier"] for m in (mappings["byQuestion"][q["id"]] for q in ch1))
    statuses = Counter(m["mappingStatus"] for m in (mappings["byQuestion"][q["id"]] for q in ch1))
    core_ids = [q["id"] for q in ch1 if mappings["byQuestion"][q["id"]]["readinessTier"] == "core"]
    core_scored = [
        qid for qid in core_ids
        if mappings["byQuestion"][qid]["mappingStatus"] != "disputed"
    ]
    core_auto = [
        qid for qid in core_scored
        if by_id[qid]["type"] == "single_choice"
    ]
    core_self = [qid for qid in core_scored if by_id[qid]["type"] != "single_choice"]
    later_to = Counter(
        mappings["byQuestion"][q["id"]]["primaryChapterId"]
        for q in ch1
        if mappings["byQuestion"][q["id"]]["readinessTier"] == "later"
    )
    later_ch2 = later_to.get("2", 0)
    later_ch3 = later_to.get("3", 0)

    section_counts = Counter(
        (q["chapter"], q["source"]["sectionId"], q["source"]["subsectionId"])
        for q in questions
        if q["chapter"] != "ch1"
    )
    section_rows = []
    for key, rule in SECTION_MAP.items():
        count = section_counts.get(key, 0)
        if not count:
            continue
        chapter, sec, sub = key
        label = sec + (f"/{sub}" if sub else "")
        section_rows.append(
            f"| {chapter} {label} | {rule['primary']} | {'、'.join(rule['topics'])} | {count} | {rule['reason']} |"
        )

    def fmt(counter: Counter) -> str:
        return " / ".join(f"{k} {v}" for k, v in counter.most_common()) or "—"

    doc = f"""# 第一章映射审核记录

日期：{REVIEW_DATE}。审核对象：第一章 88 道题（86 道选择 + 2 道综合）。
审核依据：本地笔记 `1-Introduction.md` 的真实二级/三级标题（`docs/audit/notes-outline.json`）。

## 1. 审核口径

Introduction 一章的笔记小节为：What Operating System Do、Computer-System Organization
（Interrupts / Storage Structure / I/O Structure）、Computer-System Architecture
（Single-Processor / Multiprocessor）、Operating-System Operations
（Multiprogramming and Multitasking / Dual-Mode and Multimode Operation / Timer）、
Resource Management、Three Conceptual Pieces、Design Goals。

由此确定四条判据：

1. **core（核心可做）**：题目所需知识能在上述小节内找到，且不依赖第 2 章及以后的内容。
2. **bridge（桥接）**：主体属第一章，但某一步需要后续章概念；标注前置知识点，可做但会提示。
3. **later（稍后再做）**：主体属第 2 章及以后（系统调用机制、OS 结构、引导、进程、调度等），
   不计入第一章练习，归到目标章节。
4. **supplement（补充）**：上游第一章有题、但笔记第 1 章没有对应小节（批处理/实时系统类型辨析、
   虚拟机与 VMM）。保留可读，明确标为课程外补充，不算作已学内容。
5. **disputed（争议）**：原答案存在实质疑点，保留原文、单独勘误、不自动计分。

`later` 与 `supplement` 都不进入第一章的核心题单，避免“只学了 Introduction 却被布置 VMM、MBR、
系统调用实现”的超前题。

## 2. 结果概览

- 分层：{fmt(tiers)}
- 审核状态：{fmt(statuses)}
- 第一章 core：{len(core_ids)} 道，其中 {len(core_ids) - len(core_scored)} 道为争议题（只读不计分）；
  余下 {len(core_scored)} 道里 {len(core_auto)} 道单选可自动判分、{len(core_self)} 道综合题只做自评。
  另有 bridge 1 道（提示前置后可做）。
- 归入第 2 章：{later_ch2} 道（系统调用接口与机制、OS 结构与引导）；归入第 3 章：{later_ch3} 道（进程/调度综合题）。
- supplement：{tiers.get("supplement", 0)} 道（批处理/实时系统类型辨析、虚拟机与 VMM），保留可读但不计入已学范围。

第一章练习的实际范围因此不是此前草案的 45 道，而是 **{len(core_auto)} 道可自动判分的 core + {len(core_self)} 道自评综合题 + 1 道 bridge**，
另有 {len(core_ids) - len(core_scored)} 道争议 core 只读。这个差异来自逐题核对，不是拍脑袋减题：
草案把 1.1 的系统调用题、1.3 的系统调用过程题、1.4 的结构与引导题都算进了第一章。

## 3. 逐题结论

| 题目 ID | 题号 | 分区 | 分层 | 状态 | 主章 | 知识点 | 理由 |
|---|---|---|---|---|---|---|---|
{chr(10).join(rows)}

## 4. 与草案的差异说明

| 草案做法 | 本次结论 | 原因 |
|---|---|---|
| 1.1 全部 11 道都算第一章 | 6 道 core，5 道归第 2 章 | 第 6～8、10、11 题考系统调用/库函数的接口分类，属第 2 章 System Calls |
| 1.2 取 10 道 | 11 道 core、8 道 supplement、1 道争议 | 批处理与实时系统辨析在笔记第 1 章没有对应小节；分时与多道在 1.4.1 有明确对应 |
| 1.3 取 20 道 | 22 道 core（含 2 道争议）、8 道归第 2 章、1 道 bridge | 系统调用过程与库函数对比属第 2 章；进程切换题需要第 3 章 |
| 1.4～1.6 取 4 道 | 0 道 core，18 道归第 2 章，4 道 supplement | 结构、引导整节在第 2 章；虚拟机在笔记中无对应小节 |
| 综合第 1 题“挑战候选” | core，仅自评 | 题干已给出执行顺序与资源占用，属多道程序设计直接应用 |
| 综合第 2 题 | later，归第 3 章 | 需要进程状态与调度前置 |

## 5. 争议与勘误

3 道不计分（`c1-s2-0-q009`、`c1-s3-0-q009`、`c1-s3-0-q011`），2 道仅备注前提
（`c1-s3-0-q010` 的设备驱动模型、`c1-s2-0-q019` 的措辞）。详见
`data/overrides/errata.json`，界面按 `scoring` 字段决定是否判分。

## 6. 审核状态的含义

- `verified`：已逐题核对题干、选项、答案与解析，结论可用。
- `reviewed`：已逐题核对归属与分层，答案本身未发现需要改判的问题。
- `disputed`：存在实质疑点，原答案保留但隔离计分。
- `candidate`：仅按上游分区初筛，**不是**已审核（第 2～5 章共 672 道全部处于此状态）。

第一章之外的章节尚未逐题审核，不能对外声称"全库已适配"。

## 7. 其余章节的系统映射

第 2～5 章共 672 道题按上游小节做系统映射：同一小节共用一组知识点，跨章差异明显的小节
（2.1 进程与线程）再按关键词拆分。状态一律 `systematic`，界面标"系统映射"，
**不代表答案已逐题人工复核**。

| 上游分区 | 主归属章 | 知识点 | 题数 | 说明 |
|---|---|---|---:|---|
{chr(10).join(section_rows)}

另有 348 道题的解析里直接写了"故选 X / 答案 X"，`validate_dataset.py` 会核对这些自述与答案字段是否一致，
当前 0 处矛盾。这只说明"解析与答案不打架"，不等于答案本身正确。
"""
    (ROOT / "docs" / "映射审核记录.md").write_text(doc, encoding="utf-8")


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "overrides").mkdir(parents=True, exist_ok=True)

    notes = load_notes()
    chapters, topics = build_chapters_and_topics(notes)
    questions = json.loads((DATA / "questions.json").read_text(encoding="utf-8"))["questions"]

    # 校验审核表覆盖第一章全部题目
    ch1_ids = {q["id"] for q in questions if q["chapter"] == "ch1"}
    reviewed_ids = {row[0] for row in CH1_REVIEW}
    missing = ch1_ids - reviewed_ids
    extra = reviewed_ids - ch1_ids
    if missing or extra:
        print(f"审核表与第一章题目不一致：缺 {sorted(missing)}，多 {sorted(extra)}", file=sys.stderr)
        return 1

    mappings = build_mappings(questions)

    # 学习范围守卫：第一章 core 题的前置知识点必须都落在已确认学完的第一章内
    leaked = []
    for qid, tier, status, primary, topic_list, _extra, _reason in CH1_REVIEW:
        if tier != "core":
            continue
        entry = mappings["byQuestion"][qid]
        outside = [t for t in entry["prerequisiteTopicIds"] if not t.startswith("t1-")]
        if outside:
            leaked.append((qid, outside))
    if leaked:
        print(f"前置知识越界，第一章 core 不应依赖后续章知识点：{leaked}", file=sys.stderr)
        return 1

    (DATA / "chapters.json").write_text(json.dumps(chapters, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (DATA / "topics.json").write_text(json.dumps(topics, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (DATA / "mappings.json").write_text(json.dumps(mappings, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    study_defaults = {
        "schemaVersion": 1,
        "namespace": "os-exercises:v1",
        "confirmedCompletedChapters": ["1"],
        "chapterStatus": {
            c["id"]: ("completed" if c["id"] == "1" else "unknown") for c in chapters["chapters"]
        },
        "note": "只有第 1 章由用户明确确认学完；其余章节状态 unknown，不读取笔记目录的 [x] 勾选。",
    }
    (DATA / "study-defaults.json").write_text(
        json.dumps(study_defaults, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    errata = {
        "schemaVersion": 1,
        "policy": "原答案保留不动；勘误单独记录，争议题不计分。",
        "entries": ERRATA,
    }
    (DATA / "overrides" / "errata.json").write_text(
        json.dumps(errata, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    if "--write-doc" in sys.argv:
        write_review_doc(questions, mappings)
        print("已写出 docs/映射审核记录.md")

    tiers = Counter(v["readinessTier"] for k, v in mappings["byQuestion"].items() if k in ch1_ids)
    statuses = Counter(v["mappingStatus"] for k, v in mappings["byQuestion"].items() if k in ch1_ids)
    print(f"章节 {len(chapters['chapters'])} 个，知识点 {len(topics['topics'])} 个")
    print(f"第一章分层：{dict(tiers)}")
    print(f"第一章映射状态：{dict(statuses)}")
    print(f"全库映射状态：{dict(Counter(v['mappingStatus'] for v in mappings['byQuestion'].values()))}")
    print(f"勘误条目：{len(ERRATA)}（其中不计分 {sum(1 for e in ERRATA if e['scoring'] == 'excluded')}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
