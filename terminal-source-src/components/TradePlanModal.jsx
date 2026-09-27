import React from "react";
export default function TradePlanModal({ selection, onClose, onSave }) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">TRADE PLAN</span>
            <h2 id="plan-title">把判断写成计划</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.currentTarget));
            onSave({ ...d, id: crypto.randomUUID(), createdAt: Date.now() });
          }}
        >
          <div className="form-grid">
            <label>
              标的
              <input name="symbol" value={selection.symbol} readOnly />
            </label>
            <label>
              周期
              <input name="timeframe" value={selection.timeframe} readOnly />
            </label>
            <label>
              方向
              <select name="direction">
                <option value="long">做多</option>
                <option value="short">做空</option>
              </select>
            </label>
            <label>
              风险等级
              <select name="riskLevel">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
          </div>
          <label>
            入场思路
            <textarea
              name="entryIdea"
              autoFocus
              required
              maxLength={1000}
              placeholder="什么条件满足后，才考虑入场？"
            />
          </label>
          <label>
            失效条件
            <textarea
              name="invalidation"
              required
              maxLength={1000}
              placeholder="什么发生时，这个判断不再成立？"
            />
          </label>
          <label>
            备注
            <textarea
              name="note"
              maxLength={1000}
              placeholder="补充仓位思路或需要继续观察的细节"
            />
          </label>
          <div className="modal-actions">
            <span>仅记录计划，不会下单</span>
            <button className="primary">保存计划</button>
          </div>
        </form>
      </section>
    </div>
  );
}
