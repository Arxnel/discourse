import Controller from "@ember/controller";
import discourseComputed from "discourse-common/utils/decorators";

export default Controller.extend({
  queryParams: ["glimmer"],

  @discourseComputed("glimmer")
  useGlimmer(glimmer) {
    return glimmer === "1";
  },
});
